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
  assert.ok(objects.some(entry => entry.id === "info" && entry.object.type === "channel"));
  assert.ok(objects.some(entry => entry.id === "diagnostics.api" && entry.object.type === "channel"));
  assert.ok(objects.some(entry => entry.id === "diagnostics.api.limit" && entry.object.type === "channel"));
  assert.equal(objects.find(entry => entry.id === "diagnostics.support.createReport").object.common.read, false);
  assert.deepEqual(
    states.find(entry => entry.id === "write.queueLength"),
    { id: "write.queueLength", state: { val: 0, ack: true, q: 0 } }
  );
});

test("syncFeature creates complete hierarchy and type-compatible roles", async () => {
  const objects = new Map();
  const states = [];
  const adapter = {
    setObjectNotExistsAsync: async (id, object) => {
      if (!objects.has(id)) {
        objects.set(id, structuredClone(object));
      }
    },
    extendObjectAsync: async (id, object) => objects.set(id, structuredClone(object)),
    setStateAsync: async (id, state) => states.push({ id, state }),
    getStateAsync: async () => null
  };

  const sync = new StateSync(adapter);
  await sync.syncFeature("0", {
    feature: "heating.dhw.schedule",
    properties: {
      active: { value: true },
      status: { value: "enabled" },
      temperature: { value: 48, unit: "celsius" },
      entries: { value: [{ start: "06:00", end: "08:00" }] }
    },
    commands: {}
  });

  for (const id of [
    "raw.devices",
    "raw.devices.0",
    "raw.devices.0.features",
    "raw.devices.0.features.heating",
    "raw.devices.0.features.heating.dhw",
    "raw.devices.0.features.heating.dhw.schedule",
    "raw.devices.0.features.heating.dhw.schedule.properties"
  ]) {
    assert.equal(objects.get(id)?.type, "channel", `missing channel ${id}`);
  }

  assert.equal(objects.get("raw.devices.0.features.heating.dhw.schedule.properties.active").common.role, "indicator");
  assert.equal(objects.get("raw.devices.0.features.heating.dhw.schedule.properties.status").common.role, "text");
  assert.equal(objects.get("raw.devices.0.features.heating.dhw.schedule.properties.temperature").common.role, "value");
  assert.equal(objects.get("raw.devices.0.features.heating.dhw.schedule.properties.entries").common.role, "json");
  assert.equal(states.length, 4);
});
