import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTHORIZATION_URL,
  DEFAULT_SCOPE,
  createAuthorizationUrl,
  createPkce,
  exchangeAuthorizationCode,
  extractCodeAndState,
  normalizeScope,
  tokenNativePatch
} from "../src/lib/viessmann-client/oauth.js";

test("createPkce returns url-safe verifier, challenge and state", () => {
  const pkce = createPkce();

  assert.match(pkce.verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]+$/);
  assert.match(pkce.state, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(pkce.verifier, pkce.challenge);
});

test("createAuthorizationUrl includes required OAuth PKCE parameters", () => {
  const auth = createAuthorizationUrl({
    clientId: "client-id",
    redirectUri: "http://localhost:8097/callback",
    scope: DEFAULT_SCOPE
  });
  const url = new URL(auth.url);

  assert.equal(url.origin + url.pathname, AUTHORIZATION_URL);
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8097/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), DEFAULT_SCOPE);
  assert.equal(url.searchParams.get("code_challenge"), auth.challenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), auth.state);
});

test("normalizeScope keeps required Viessmann scopes once", () => {
  assert.equal(normalizeScope("User offline_access IoT User"), DEFAULT_SCOPE);
  assert.equal(normalizeScope(""), DEFAULT_SCOPE);
});

test("extractCodeAndState supports raw code, query strings and callback urls", () => {
  assert.deepEqual(extractCodeAndState("abc123"), { code: "abc123", state: "" });
  assert.deepEqual(extractCodeAndState("?code=abc&state=xyz"), { code: "abc", state: "xyz" });
  assert.deepEqual(extractCodeAndState("http://localhost:8097/callback?code=abc&state=xyz"), {
    code: "abc",
    state: "xyz"
  });
});

test("extractCodeAndState rejects missing code", () => {
  assert.throws(() => extractCodeAndState(""), /Missing OAuth code/);
  assert.throws(() => extractCodeAndState("?state=xyz"), /contains no code/);
});

test("tokenNativePatch maps token response without exposing raw response shape", () => {
  const before = Date.now();
  const patch = tokenNativePatch({
    access_token: "access",
    refresh_token: "refresh",
    expires_in: 3600
  });

  assert.equal(patch.accessToken, "access");
  assert.equal(patch.refreshToken, "refresh");
  assert.ok(patch.tokenExpiresAt >= before + 3_599_000);
  assert.match(patch.oauthTokenCreatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("exchangeAuthorizationCode redacts credentials echoed by an OAuth error", async t => {
  const originalFetch = globalThis.fetch;
  const code = "authorization/code+release-marker";
  const verifier = "pkce/verifier+release-marker";
  const clientSecret = "client/secret+release-marker";
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: "invalid_grant",
        error_description: `${encodeURIComponent(code)} ${encodeURIComponent(verifier)} ${encodeURIComponent(clientSecret)}`
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );

  await assert.rejects(
    exchangeAuthorizationCode({
      clientId: "client-id",
      clientSecret,
      redirectUri: "http://localhost:8097/callback",
      code,
      verifier
    }),
    error => {
      assert.match(error.message, /OAuth token request failed: HTTP 400/);
      for (const marker of [code, verifier, clientSecret]) {
        assert.equal(error.message.includes(marker), false);
        assert.equal(error.message.includes(encodeURIComponent(marker)), false);
      }
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );
});
