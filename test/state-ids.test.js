import test from "node:test";
import assert from "node:assert/strict";

import {
  allowlistCommandStateId,
  controlCommandStateId,
  controlCurrentStateId,
  discoveredCommandStateId,
  rawCommandStateId,
  rawFeatureBaseId,
  rawPropertyStateId,
  sanitizeId
} from "../src/lib/state/ids.js";

test("sanitizeId keeps ioBroker-friendly characters", () => {
  assert.equal(sanitizeId("heating.dhw.temperature.main"), "heating.dhw.temperature.main");
  assert.equal(sanitizeId(" Room Control / 1 "), "Room_Control_1");
  assert.equal(sanitizeId("__bad//id__"), "bad_id");
});

test("raw state ids are built from sanitized device and feature names", () => {
  assert.equal(
    rawFeatureBaseId("Room Control/1", "heating.dhw.temperature.main"),
    "raw.devices.Room_Control_1.features.heating.dhw.temperature.main"
  );
  assert.equal(
    rawPropertyStateId("0", "heating.dhw.temperature.main", "target value"),
    "raw.devices.0.features.heating.dhw.temperature.main.properties.target_value"
  );
  assert.equal(
    rawCommandStateId("0", "heating.dhw.temperature.main", "setTargetTemperature"),
    "raw.devices.0.features.heating.dhw.temperature.main.commands.setTargetTemperature"
  );
});

test("write related ids use the expected namespaces", () => {
  assert.equal(
    controlCommandStateId("heating.dhw.temperature.main", "setTargetTemperature"),
    "control.heating.dhw.temperature.main.setTargetTemperature"
  );
  assert.equal(
    controlCurrentStateId("heating.dhw.temperature.main", "value"),
    "control.heating.dhw.temperature.main.current.value"
  );
  assert.equal(
    discoveredCommandStateId("heating.dhw.temperature.main", "setTargetTemperature"),
    "writes.discovered.heating.dhw.temperature.main.setTargetTemperature"
  );
  assert.equal(
    allowlistCommandStateId("heating.dhw.temperature.main", "setTargetTemperature"),
    "writes.allowlist.heating.dhw.temperature.main.setTargetTemperature.enabled"
  );
});
