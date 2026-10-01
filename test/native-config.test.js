import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

test("donation URL stays hidden while donation copy and button remain visible", () => {
  const adminConfig = JSON.parse(readFileSync(new URL("../admin/jsonConfig.json", import.meta.url), "utf8"));
  const items = adminConfig.items.oauthTab.items;

  assert.equal(Object.hasOwn(items, "paypalDonationUrl"), false);
  assert.equal(items._donationHeader.text, "donationHeader");
  assert.equal(items._donationText.text, "donationText");
  assert.equal(items.openDonationUrl.label, "openDonationUrl");
  assert.equal(items.openDonationUrl.openUrl, true);
  assert.equal(Object.hasOwn(items.openDonationUrl, "disabled"), false);
  assert.equal(Object.hasOwn(items.openDonationUrl, "jsonData"), false);
});
