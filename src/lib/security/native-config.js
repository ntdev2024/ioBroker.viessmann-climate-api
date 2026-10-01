export const ENCRYPTED_NATIVE_KEYS = new Set([
  "clientSecret",
  "accessToken",
  "refreshToken",
  "oauthCode",
  "oauthPkceVerifier",
  "oauthPkceState"
]);

export function encryptNativePatch(native, encrypt) {
  const result = { ...native };
  for (const key of ENCRYPTED_NATIVE_KEYS) {
    const value = result[key];
    if (typeof value === "string" && value) {
      result[key] = encrypt(value);
    }
  }
  return result;
}
