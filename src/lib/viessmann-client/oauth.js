import crypto from "node:crypto";
import { redactSensitiveText, safeErrorMessage } from "../security/redaction.js";

export const AUTHORIZATION_URL = "https://iam.viessmann-climatesolutions.com/idp/v3/authorize";
export const TOKEN_URL = "https://iam.viessmann-climatesolutions.com/idp/v3/token";
export const DEFAULT_SCOPE = "IoT User offline_access";
export const DEFAULT_TOKEN_REQUEST_TIMEOUT_MS = 30_000;

function base64Url(buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function createPkce() {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64Url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

export function createAuthorizationUrl({ clientId, redirectUri, scope }) {
  const pkce = createPkce();
  const url = new URL(AUTHORIZATION_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope || DEFAULT_SCOPE);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", pkce.state);
  return { url: url.toString(), ...pkce };
}

export function normalizeScope(scope) {
  const parts = String(scope || DEFAULT_SCOPE)
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  const unique = [...new Set(parts)];
  const required = ["IoT", "User", "offline_access"];
  const extras = unique.filter(part => !required.includes(part));
  return [...required, ...extras].join(" ");
}

export function extractCodeAndState(value) {
  const input = String(value || "").trim();
  if (!input) {
    throw new Error("Missing OAuth code or callback URL.");
  }

  if (!input.includes("=") && !input.includes("?")) {
    return { code: input, state: "" };
  }

  const url =
    input.startsWith("http://") || input.startsWith("https://")
      ? new URL(input)
      : new URL(input.startsWith("?") ? `http://localhost/${input}` : `http://localhost/?${input}`);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code) {
    throw new Error("Callback URL contains no code parameter.");
  }
  return { code, state };
}

async function postTokenForm(form, { signal, timeoutMs = DEFAULT_TOKEN_REQUEST_TIMEOUT_MS } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signals = signal ? [signal, timeoutSignal] : [timeoutSignal];
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      signal: AbortSignal.any(signals)
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    if (!response.ok) {
      const safeBody = redactSensitiveText(JSON.stringify(body), {
        sensitiveValues: [form.client_secret, form.code, form.code_verifier, form.refresh_token]
      });
      throw new Error(`OAuth token request failed: HTTP ${response.status} ${safeBody}`);
    }
    return body;
  } catch (error) {
    if (signal?.aborted) {
      throw new Error("OAuth token request aborted because the adapter is unloading.");
    }
    if (timeoutSignal.aborted) {
      throw new Error(`OAuth token request timed out after ${timeoutMs} ms.`);
    }
    throw new Error(
      safeErrorMessage(error, {
        sensitiveValues: [form.client_secret, form.code, form.code_verifier, form.refresh_token]
      }),
      { cause: error }
    );
  }
}

export async function exchangeAuthorizationCode({
  clientId,
  clientSecret,
  redirectUri,
  code,
  verifier,
  signal,
  timeoutMs
}) {
  const form = {
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier
  };
  if (clientSecret) {
    form.client_secret = clientSecret;
  }
  return postTokenForm(form, { signal, timeoutMs });
}

export function tokenNativePatch(tokens) {
  const expiresIn = Number(tokens.expires_in || 0);
  return {
    accessToken: tokens.access_token || "",
    refreshToken: tokens.refresh_token || "",
    tokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : 0,
    oauthTokenCreatedAt: new Date().toISOString()
  };
}
