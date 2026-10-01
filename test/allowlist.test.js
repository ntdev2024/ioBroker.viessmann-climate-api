import test from "node:test";
import assert from "node:assert/strict";

import { commandKey, isWriteAllowed, WRITE_ALLOWLIST } from "../src/lib/write/allowlist.js";

test("commandKey combines feature and command", () => {
  assert.equal(
    commandKey("heating.dhw.temperature.main", "setTargetTemperature"),
    "heating.dhw.temperature.main:setTargetTemperature"
  );
});

test("known v1 commands are allowlisted", () => {
  assert.equal(isWriteAllowed("heating.dhw.temperature.main", "setTargetTemperature"), true);
  assert.equal(isWriteAllowed("heating.dhw.oneTimeCharge", "activate"), true);
});

test("unknown or mismatched commands are denied", () => {
  assert.equal(isWriteAllowed("heating.dhw.temperature.main", "setTemperature"), false);
  assert.equal(isWriteAllowed("heating.circuits.1.name", "setName"), false);
});

test("allowlist does not contain duplicate entries", () => {
  assert.equal(WRITE_ALLOWLIST.size, Array.from(WRITE_ALLOWLIST).length);
});
