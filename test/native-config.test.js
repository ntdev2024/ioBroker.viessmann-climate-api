import test from "node:test";
import assert from "node:assert/strict";

import { encryptNativePatch } from "../src/lib/security/native-config.js";

test("encryptNativePatch encrypts secrets without mutating runtime values", () => {
  const native = {
    clientId: "public-client",
    accessToken: "plain-access-token",
    refreshToken: "plain-refresh-token",
    oauthPkceVerifier: "",
    tokenExpiresAt: 12345
  };
  const encrypted = encryptNativePatch(native, value => `encrypted:${value}`);

  assert.deepEqual(encrypted, {
    clientId: "public-client",
    accessToken: "encrypted:plain-access-token",
    refreshToken: "encrypted:plain-refresh-token",
    oauthPkceVerifier: "",
    tokenExpiresAt: 12345
  });
  assert.equal(native.accessToken, "plain-access-token");
  assert.equal(native.refreshToken, "plain-refresh-token");
});
