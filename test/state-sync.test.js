import test from "node:test";
import assert from "node:assert/strict";

import { StateSync } from "../src/lib/state/state-sync.js";

test("ensureBaseStates initializes write queue length", async () => {
  const objects = [];
  const states = [];
  const adapter = {
    setObjectNotExistsAsync: async (id, object) => objects.push({ id, object }),
    setStateAsync: async (id, state) => states.push({ id, state })
  };

  const sync = new StateSync(adapter);
  await sync.ensureBaseStates();

  assert.ok(objects.some(entry => entry.id === "write.queueLength"));
  assert.deepEqual(
    states.find(entry => entry.id === "write.queueLength"),
    { id: "write.queueLength", state: { val: 0, ack: true, q: 0 } }
  );
});
