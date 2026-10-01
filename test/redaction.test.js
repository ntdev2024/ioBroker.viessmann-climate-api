import test from "node:test";
import assert from "node:assert/strict";

import { redactSensitiveText, safeErrorMessage } from "../src/lib/security/redaction.js";

const jwtMarker = "eyJhbGciOiJIUzI1NiJ9.release-marker.signature";
const refreshMarker = "refresh-release-marker";
const secretMarker = "client-secret-release-marker";

test("redacts bearer values and removes log-injection control characters", () => {
  const result = safeErrorMessage(
    new Error(`Headers.append: "Bearer \u0004${jwtMarker}\nfor endpoint /iot/v2/features"`)
  );

  assert.equal(result.includes(jwtMarker), false);
  assert.equal(result.includes("\u0004"), false);
  assert.equal(result.includes("\n"), false);
  assert.match(result, /Headers\.append/);
  assert.match(result, /Bearer \[REDACTED\]/);
  assert.match(result, /endpoint \/iot\/v2\/features/);
});

test("redacts JSON, query-string and form encoded OAuth credentials", () => {
  const result = redactSensitiveText(
    `HTTP 401 {"access_token":"${jwtMarker}","refresh_token":"${refreshMarker}"} ` +
      `client_secret=${secretMarker}&code=authorization-code&code_verifier=pkce-verifier`
  );

  for (const marker of [jwtMarker, refreshMarker, secretMarker, "authorization-code", "pkce-verifier"]) {
    assert.equal(result.includes(marker), false);
  }
  assert.match(result, /HTTP 401/);
  assert.match(result, /\[REDACTED\]/);
});

test("redacts known secret values even when an upstream error omits a field label", () => {
  const encodedSecret = "client secret/+release-marker";
  const result = redactSensitiveText(`Socket rejected ${refreshMarker} and ${encodeURIComponent(encodedSecret)}`, {
    sensitiveValues: [refreshMarker, encodedSecret]
  });

  assert.equal(result.includes(refreshMarker), false);
  assert.equal(result.includes(encodeURIComponent(encodedSecret)), false);
  assert.equal(result, "Socket rejected [REDACTED] and [REDACTED]");
});
