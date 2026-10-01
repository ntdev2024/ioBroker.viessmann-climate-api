export const WRITE_ALLOWLIST = new Set([
  "heating.circuits.1.operating.modes.active:setMode",
  "heating.circuits.1.operating.programs.comfort:activate",
  "heating.circuits.1.operating.programs.comfort:deactivate",
  "heating.circuits.1.operating.programs.comfort:setTemperature",
  "heating.circuits.1.operating.programs.normal:setTemperature",
  "heating.circuits.1.operating.programs.reduced:setTemperature",
  "heating.dhw.oneTimeCharge:activate",
  "heating.dhw.oneTimeCharge:deactivate",
  "heating.dhw.oneTimeCharge:setActive",
  "heating.dhw.temperature.main:setTargetTemperature",
  "heating.dhw.temperature.temp2:setTargetTemperature"
]);

export function commandKey(feature, command) {
  return `${feature}:${command}`;
}

export function isWriteAllowed(feature, command) {
  return WRITE_ALLOWLIST.has(commandKey(feature, command));
}
