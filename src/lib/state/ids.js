/**
 *
 * @param value
 */
export function sanitizeId(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function rawFeatureBaseId(deviceId, featureName) {
  return `raw.devices.${sanitizeId(deviceId)}.features.${sanitizeId(featureName)}`;
}

export function rawPropertyStateId(deviceId, featureName, propertyName) {
  return `${rawFeatureBaseId(deviceId, featureName)}.properties.${sanitizeId(propertyName)}`;
}

export function rawCommandStateId(deviceId, featureName, commandName) {
  return `${rawFeatureBaseId(deviceId, featureName)}.commands.${sanitizeId(commandName)}`;
}

export function controlCommandStateId(featureName, commandName) {
  return `control.${sanitizeId(featureName)}.${sanitizeId(commandName)}`;
}

export function controlCurrentStateId(featureName, propertyName) {
  return `control.${sanitizeId(featureName)}.current.${sanitizeId(propertyName)}`;
}

export function discoveredCommandStateId(featureName, commandName) {
  return `writes.discovered.${sanitizeId(featureName)}.${sanitizeId(commandName)}`;
}

export function allowlistCommandStateId(featureName, commandName) {
  return `writes.allowlist.${sanitizeId(featureName)}.${sanitizeId(commandName)}.enabled`;
}
