import test from "node:test";
import assert from "node:assert/strict";

import { ViessmannClient } from "../src/lib/viessmann-client/client.js";

function createAdapter() {
  const states = [];
  return {
    namespace: "viessmann-climate-api.0",
    states,
    setStateAsync: async (id, state) => states.push({ id, state }),
    logInfo: () => {},
    extendForeignObjectAsync: async () => {}
  };
}

function installHangingFetch(t) {
  const originalFetch = globalThis.fetch;
  const keepAlive = setTimeout(() => {}, 1000);
  globalThis.fetch = (_url, options = {}) =>
    new Promise((_resolve, reject) => {
      const rejectAbort = () => reject(options.signal?.reason || new Error("aborted"));
      if (options.signal?.aborted) {
        rejectAbort();
      } else {
        options.signal?.addEventListener("abort", rejectAbort, { once: true });
      }
    });
  t.after(() => {
    clearTimeout(keepAlive);
    globalThis.fetch = originalFetch;
  });
}

test("fetchRaw aborts a hanging request after the configured timeout", async t => {
  installHangingFetch(t);
  const client = new ViessmannClient({
    adapter: createAdapter(),
    requestTimeoutMs: 10
  });

  await assert.rejects(() => client.fetchRaw("https://example.invalid", { method: "GET" }), /timed out after 10 ms/);
  assert.equal(client.activeControllers.size, 0);
});

test("stop aborts active requests and prevents diagnostic state writes", async t => {
  installHangingFetch(t);
  const adapter = createAdapter();
  const client = new ViessmannClient({ adapter, requestTimeoutMs: 60_000 });
  const request = client.fetchRaw("https://example.invalid", { method: "GET" });

  await new Promise(resolve => setImmediate(resolve));
  client.stop();

  await assert.rejects(() => request, /adapter is unloading/);
  assert.equal(adapter.states.length, 0);
  assert.equal(client.activeControllers.size, 0);
});

test("fetchApi does not expose an invalid bearer token in header errors", async t => {
  const tokenMarker = "eyJhbGciOiJIUzI1NiJ9.release-marker.signature";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError(`Headers.append: "Bearer \u0004${tokenMarker}"`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const client = new ViessmannClient({
    adapter: createAdapter(),
    accessToken: `\u0004${tokenMarker}`,
    refreshToken: "refresh-release-marker",
    tokenExpiresAt: Date.now() + 60_000
  });

  await assert.rejects(
    () => client.get("/iot/v2/features"),
    error =>
      error.message.includes("Bearer [REDACTED]") &&
      !error.message.includes(tokenMarker) &&
      !error.message.includes("\u0004")
  );
});
