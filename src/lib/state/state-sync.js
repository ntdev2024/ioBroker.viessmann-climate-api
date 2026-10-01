import {
  allowlistCommandStateId,
  controlCommandStateId,
  controlCurrentStateId,
  discoveredCommandStateId,
  rawCommandStateId,
  rawFeatureBaseId,
  rawPropertyStateId
} from "./ids.js";

function stateType(value) {
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  return "string";
}

function normalizeValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

export class StateSync {
  constructor(adapter) {
    this.adapter = adapter;
    this.activeControlIds = new Set();
  }

  async ensureBaseStates() {
    for (const channel of [
      ["raw", "Raw Viessmann Climate API data"],
      ["summary", "Readable Viessmann summary values"],
      ["control", "Allowlisted Viessmann write controls"],
      ["writes", "Viessmann write discovery and allowlist"],
      ["diagnostics", "Viessmann adapter diagnostics"]
    ]) {
      await this.adapter.setObjectNotExistsAsync(channel[0], {
        type: "channel",
        common: { name: channel[1] },
        native: {}
      });
    }

    await this.adapter.setObjectNotExistsAsync("info.connection", {
      type: "state",
      common: {
        name: "Viessmann Climate API connection",
        type: "boolean",
        role: "indicator.connected",
        read: true,
        write: false
      },
      native: {}
    });
    await this.adapter.setObjectNotExistsAsync("write.command", {
      type: "state",
      common: {
        name: "Queued write command as JSON",
        type: "string",
        role: "json",
        read: true,
        write: true
      },
      native: {
        example: {
          deviceId: "0",
          feature: "heating.dhw.oneTimeCharge",
          command: "setActive",
          params: { active: true }
        }
      }
    });
    await this.adapter.setObjectNotExistsAsync("write.lastResult", {
      type: "state",
      common: {
        name: "Last write result",
        type: "string",
        role: "json",
        read: true,
        write: false
      },
      native: {}
    });
    await this.adapter.setObjectNotExistsAsync("write.queueLength", {
      type: "state",
      common: {
        name: "Write queue length",
        type: "number",
        role: "value",
        read: true,
        write: false
      },
      native: {}
    });
    await this.adapter.setStateAsync("write.queueLength", { val: 0, ack: true, q: 0 });
    await this.ensureState(
      "diagnostics.api.limit.used24h",
      "Used Viessmann Climate API requests in rolling 24 hours",
      "number",
      "value"
    );
    await this.ensureState(
      "diagnostics.api.limit.remaining24h",
      "Remaining Viessmann Climate API requests in rolling 24 hours",
      "number",
      "value"
    );
    await this.ensureState(
      "diagnostics.api.limit.requestTimestampsJson",
      "Persisted Viessmann API request timestamps in rolling 24 hours",
      "string",
      "json"
    );
    await this.ensureState("diagnostics.runtime.memory.rssMb", "Resident memory in MB", "number", "value");
    await this.ensureState("diagnostics.runtime.memory.heapUsedMb", "Used heap memory in MB", "number", "value");
    await this.ensureState("diagnostics.runtime.memory.heapTotalMb", "Total heap memory in MB", "number", "value");
    await this.ensureState("diagnostics.runtime.uptimeSeconds", "Adapter process uptime in seconds", "number", "value");
    await this.adapter.setObjectNotExistsAsync("diagnostics.support.createReport", {
      type: "state",
      common: {
        name: "Create redacted Viessmann support report",
        type: "boolean",
        role: "button",
        read: true,
        write: true,
        def: false
      },
      native: {}
    });
    await this.ensureState("diagnostics.support.lastCreatedAt", "Last support report creation time", "string", "date");
    await this.ensureState("diagnostics.support.report", "Redacted Viessmann support report as JSON", "string", "json");
  }

  beginControlRebuild() {
    this.activeControlIds = new Set();
  }

  async finishControlRebuild() {
    await this.deleteStaleControlObjects();
  }

  async syncFeature(deviceId, feature) {
    const featureName = feature.feature || feature.name;
    if (!featureName) {
      return;
    }

    await this.syncFeatureAt({
      baseId: rawFeatureBaseId(deviceId, featureName),
      propertyId: propertyName => rawPropertyStateId(deviceId, featureName, propertyName),
      commandId: commandName => rawCommandStateId(deviceId, featureName, commandName),
      deviceId,
      featureName,
      feature
    });
  }

  async syncFeatureAt({ baseId, propertyId, commandId, deviceId, featureName, feature }) {
    await this.adapter.setObjectNotExistsAsync(baseId, {
      type: "channel",
      common: {
        name: featureName
      },
      native: {
        enabled: feature.isEnabled,
        ready: feature.isReady
      }
    });

    await this.syncProperties(deviceId, featureName, feature.properties || {}, propertyId);
    await this.syncCommands(deviceId, featureName, feature.commands || {}, commandId, feature.properties || {});
  }

  async syncProperties(deviceId, featureName, properties, propertyId) {
    for (const [propertyName, property] of Object.entries(properties)) {
      const value = normalizeValue(property?.value ?? property);
      const id = propertyId(propertyName);
      await this.adapter.setObjectNotExistsAsync(id, {
        type: "state",
        common: {
          name: `${featureName} ${propertyName}`,
          type: stateType(value),
          role: "value",
          read: true,
          write: false,
          unit: property?.unit
        },
        native: {
          rawProperty: property
        }
      });
      await this.adapter.setStateAsync(id, { val: value, ack: true });
    }
  }

  async syncCommands(deviceId, featureName, commands, commandId, properties = {}) {
    let hasAllowedCommand = false;

    for (const [commandName, command] of Object.entries(commands)) {
      const id = commandId(commandName);
      const executable = Boolean(command?.isExecutable);
      await this.syncDiscoveredCommand(deviceId, featureName, commandName, command, executable);
      const allowed = executable && (await this.isCommandEnabled(featureName, commandName));
      hasAllowedCommand = hasAllowedCommand || allowed;
      await this.adapter.setObjectNotExistsAsync(id, {
        type: "state",
        common: {
          name: `${featureName} ${commandName}`,
          type: "string",
          role: "json",
          read: true,
          write: false,
          desc: executable ? "Discovered Viessmann command parameters as JSON" : "Discovered but not executable"
        },
        native: {
          executable,
          allowlisted: false,
          deviceId,
          featureName,
          commandName,
          command
        }
      });

      if (allowed) {
        await this.ensureControlCommand(deviceId, featureName, commandName, command);
      }
    }

    if (hasAllowedCommand) {
      await this.syncControlCurrentProperties(featureName, properties);
    }
  }

  async syncDiscoveredCommand(deviceId, featureName, commandName, command, executable) {
    const id = discoveredCommandStateId(featureName, commandName);
    const value = normalizeValue({
      deviceId,
      featureName,
      commandName,
      executable,
      params: command?.params || {},
      uri: command?.uri || ""
    });

    await this.adapter.setObjectNotExistsAsync(id, {
      type: "state",
      common: {
        name: `${featureName} ${commandName} discovered command`,
        type: "string",
        role: "json",
        read: true,
        write: false
      },
      native: {
        deviceId,
        featureName,
        commandName,
        command,
        executable
      }
    });
    await this.adapter.setStateAsync(id, { val: value, ack: true });

    const allowId = allowlistCommandStateId(featureName, commandName);
    await this.adapter.setObjectNotExistsAsync(allowId, {
      type: "state",
      common: {
        name: `${featureName} ${commandName} enabled`,
        type: "boolean",
        role: "switch.enable",
        read: true,
        write: true,
        def: false,
        desc: executable ? "Enable this Viessmann command under control" : "Command is not executable"
      },
      native: {
        deviceId,
        featureName,
        commandName,
        executable
      }
    });

    const current = await this.adapter.getStateAsync(allowId);
    await this.adapter.setStateAsync(allowId, {
      val: current?.val === true || current?.val === "true",
      ack: true,
      q: 0
    });
  }

  async isCommandEnabled(featureName, commandName) {
    const state = await this.adapter.getStateAsync(allowlistCommandStateId(featureName, commandName));
    return state?.val === true || state?.val === "true";
  }

  async ensureControlCommand(deviceId, featureName, commandName, command) {
    const id = controlCommandStateId(featureName, commandName);
    this.activeControlIds.add(`${this.adapter.namespace}.${id}`);
    await this.adapter.setObjectNotExistsAsync(id, {
      type: "state",
      common: {
        name: `${featureName} ${commandName}`,
        type: "string",
        role: "json",
        read: true,
        write: true,
        desc: "Allowlisted Viessmann command parameters as JSON"
      },
      native: {
        allowlisted: true,
        deviceId,
        featureName,
        commandName,
        command,
        source: "control"
      }
    });
  }

  async syncControlCurrentProperties(featureName, properties) {
    for (const [propertyName, property] of Object.entries(properties)) {
      const value = normalizeValue(property?.value ?? property);
      const id = controlCurrentStateId(featureName, propertyName);
      this.activeControlIds.add(`${this.adapter.namespace}.${id}`);
      await this.adapter.setObjectNotExistsAsync(id, {
        type: "state",
        common: {
          name: `${featureName} current ${propertyName}`,
          type: stateType(value),
          role: "value",
          read: true,
          write: false,
          unit: property?.unit
        },
        native: {
          featureName,
          propertyName,
          source: "control-current"
        }
      });
      await this.adapter.setStateAsync(id, { val: value, ack: true });
    }
  }

  async updateControlCurrentAfterWrite(featureName, params) {
    if (!params || typeof params !== "object") {
      return;
    }

    for (const [propertyName, value] of Object.entries(params)) {
      const directId = controlCurrentStateId(featureName, propertyName);
      if (await this.adapter.getObjectAsync(directId)) {
        await this.adapter.setStateAsync(directId, { val: normalizeValue(value), ack: true, q: 0 });
      }
    }

    const paramEntries = Object.entries(params);
    if (paramEntries.length === 1) {
      const [, value] = paramEntries[0];
      const valueId = controlCurrentStateId(featureName, "value");
      if (await this.adapter.getObjectAsync(valueId)) {
        await this.adapter.setStateAsync(valueId, { val: normalizeValue(value), ack: true, q: 0 });
      }
    }
  }

  async deleteStaleControlObjects() {
    if (typeof this.adapter.getObjectViewAsync !== "function") {
      return;
    }
    const startkey = `${this.adapter.namespace}.control.`;
    const endkey = `${this.adapter.namespace}.control.\u9999`;
    const result = await this.adapter.getObjectViewAsync("system", "state", { startkey, endkey });
    for (const row of result?.rows || []) {
      const id = row.id;
      if (!id || this.activeControlIds.has(id)) {
        continue;
      }
      const localId = id.slice(`${this.adapter.namespace}.`.length);
      await this.adapter.delObjectAsync(localId);
      await this.adapter.delStateAsync(localId);
    }
  }

  async syncSummary(devices) {
    const index = new Map();
    for (const device of devices) {
      for (const feature of device.features || []) {
        const featureName = feature.feature || feature.name;
        if (featureName) {
          index.set(featureName, feature);
        }
      }
    }

    await this.mapSummary(index, "summary.gateway.timezone", "device.timezone", "value", "string", "value");
    await this.mapSummary(index, "summary.gateway.wifiStrength", "tcu.wifi", "strength", "number", "value", "");
    await this.mapSummary(index, "summary.system.serial", "device.serial", "value", "string", "text");
    await this.mapSummary(
      index,
      "summary.system.outsideTemperature",
      "heating.sensors.temperature.outside",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );

    await this.mapSummary(
      index,
      "summary.buffer.temperature.main",
      "heating.buffer.sensors.temperature.main",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.buffer.status.mainTemperature",
      "heating.buffer.sensors.temperature.main",
      "status",
      "string",
      "text"
    );
    await this.mapSummary(
      index,
      "summary.buffer.temperature.top",
      "heating.buffer.sensors.temperature.top",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.buffer.status.topTemperature",
      "heating.buffer.sensors.temperature.top",
      "status",
      "string",
      "text"
    );
    await this.mapSummary(
      index,
      "summary.buffer.maxTemperature",
      "heating.configuration.buffer.temperature.max",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );

    await this.mapSummary(index, "summary.dhw.active", "heating.dhw", "active", "boolean", "indicator.state");
    await this.mapSummary(index, "summary.dhw.status", "heating.dhw", "status", "string", "text");
    await this.mapSummary(
      index,
      "summary.dhw.isHeating",
      "heating.dhw.charging",
      "active",
      "boolean",
      "indicator.state"
    );
    await this.mapSummary(
      index,
      "summary.dhw.isOneTimeChargeActive",
      "heating.dhw.oneTimeCharge",
      "active",
      "boolean",
      "indicator.state"
    );
    await this.mapSummary(
      index,
      "summary.dhw.temperature.current",
      "heating.dhw.sensors.temperature.dhwCylinder",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.dhw.temperature.main",
      "heating.dhw.temperature.main",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.dhw.temperature.temp2",
      "heating.dhw.temperature.temp2",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.dhw.temperature.hysteresis",
      "heating.dhw.temperature.hysteresis",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.dhw.pump.circulationStatus",
      "heating.dhw.pumps.circulation",
      "status",
      "string",
      "text"
    );
    await this.mapSummary(
      index,
      "summary.dhw.scheduleActive",
      "heating.dhw.schedule",
      "active",
      "boolean",
      "indicator.state"
    );

    await this.mapSummary(
      index,
      "summary.heating.house.active",
      "heating.circuits.1",
      "active",
      "boolean",
      "indicator.state"
    );
    await this.mapSummary(index, "summary.heating.house.name", "heating.circuits.1", "name", "string", "text");
    await this.mapSummary(
      index,
      "summary.heating.house.operatingMode",
      "heating.circuits.1.operating.modes.active",
      "value",
      "string",
      "text"
    );
    await this.mapSummary(
      index,
      "summary.heating.house.operatingProgram",
      "heating.circuits.1.operating.programs.active",
      "value",
      "string",
      "text"
    );
    await this.mapSummary(
      index,
      "summary.heating.house.supplyTemperature",
      "heating.circuits.1.sensors.temperature.supply",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.heating.house.targetTemperature",
      "heating.circuits.1.temperature",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.heating.house.curve.slope",
      "heating.circuits.1.heating.curve",
      "slope",
      "number",
      "value"
    );
    await this.mapSummary(
      index,
      "summary.heating.house.curve.shift",
      "heating.circuits.1.heating.curve",
      "shift",
      "number",
      "value"
    );
    await this.mapSummary(
      index,
      "summary.heating.house.circulationPumpStatus",
      "heating.circuits.1.circulation.pump",
      "status",
      "string",
      "text"
    );

    await this.mapSummary(
      index,
      "summary.heating.primary.temperature.supply",
      "heating.primaryCircuit.sensors.temperature.supply",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.heating.primary.temperature.return",
      "heating.primaryCircuit.sensors.temperature.return",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.heating.primary.rotation",
      "heating.primaryCircuit.sensors.rotation",
      "value",
      "number",
      "value"
    );
    await this.mapSummary(
      index,
      "summary.heating.primary.status.supplyTemperature",
      "heating.primaryCircuit.sensors.temperature.supply",
      "status",
      "string",
      "text"
    );
    await this.mapSummary(
      index,
      "summary.heating.primary.status.returnTemperature",
      "heating.primaryCircuit.sensors.temperature.return",
      "status",
      "string",
      "text"
    );

    await this.mapSummary(
      index,
      "summary.heating.secondary.temperature.supply",
      "heating.secondaryCircuit.sensors.temperature.supply",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.heating.secondary.status.supplyTemperature",
      "heating.secondaryCircuit.sensors.temperature.supply",
      "status",
      "string",
      "text"
    );

    await this.mapSummary(
      index,
      "summary.heatPump.compressor.active",
      "heating.compressors.0",
      "active",
      "boolean",
      "indicator.state"
    );
    await this.mapSummary(
      index,
      "summary.heatPump.compressor.phase",
      "heating.compressors.0",
      "phase",
      "string",
      "text"
    );
    await this.mapSummary(
      index,
      "summary.heatPump.compressor.power",
      "heating.compressors.0.power",
      "value",
      "number",
      "value.power",
      "watt"
    );
    await this.mapSummary(
      index,
      "summary.heatPump.compressor.sensorPower",
      "heating.compressors.0.sensors.power",
      "value",
      "number",
      "value.power",
      "watt"
    );
    await this.mapSummary(
      index,
      "summary.heatPump.compressor.temperature.inlet",
      "heating.compressors.0.sensors.temperature.inlet",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.heatPump.compressor.temperature.outlet",
      "heating.compressors.0.sensors.temperature.outlet",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.heatPump.compressor.temperature.overheat",
      "heating.compressors.0.sensors.temperature.overheat",
      "value",
      "number",
      "value.temperature",
      "celsius"
    );
    await this.mapSummary(
      index,
      "summary.heatPump.compressor.pressure.inlet",
      "heating.compressors.0.sensors.pressure.inlet",
      "value",
      "number",
      "value.pressure"
    );
    await this.mapSummary(
      index,
      "summary.heatPump.compressor.starts",
      "heating.compressors.0.statistics",
      "starts",
      "number",
      "value"
    );
    await this.mapSummary(
      index,
      "summary.heatPump.compressor.hours",
      "heating.compressors.0.statistics",
      "hours",
      "number",
      "value"
    );

    await this.mapSummary(index, "summary.efficiency.cop.dhw", "heating.cop.dhw", "value", "number", "value");
  }

  async syncDiagnostics(usage) {
    await this.ensureState(
      "diagnostics.api.limit.used24h",
      "Used Viessmann Climate API requests in rolling 24 hours",
      "number",
      "value"
    );
    await this.ensureState(
      "diagnostics.api.limit.remaining24h",
      "Remaining Viessmann Climate API requests in rolling 24 hours",
      "number",
      "value"
    );
    await this.adapter.setStateAsync("diagnostics.api.limit.used24h", { val: usage.used, ack: true });
    await this.adapter.setStateAsync("diagnostics.api.limit.remaining24h", { val: usage.remaining, ack: true });
  }

  async syncRuntimeDiagnostics(memory, uptimeSeconds) {
    const mb = value => Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10;
    await this.ensureState("diagnostics.runtime.memory.rssMb", "Resident memory in MB", "number", "value");
    await this.ensureState("diagnostics.runtime.memory.heapUsedMb", "Used heap memory in MB", "number", "value");
    await this.ensureState("diagnostics.runtime.memory.heapTotalMb", "Total heap memory in MB", "number", "value");
    await this.ensureState("diagnostics.runtime.uptimeSeconds", "Adapter process uptime in seconds", "number", "value");
    await this.adapter.setStateAsync("diagnostics.runtime.memory.rssMb", { val: mb(memory.rss), ack: true, q: 0 });
    await this.adapter.setStateAsync("diagnostics.runtime.memory.heapUsedMb", {
      val: mb(memory.heapUsed),
      ack: true,
      q: 0
    });
    await this.adapter.setStateAsync("diagnostics.runtime.memory.heapTotalMb", {
      val: mb(memory.heapTotal),
      ack: true,
      q: 0
    });
    await this.adapter.setStateAsync("diagnostics.runtime.uptimeSeconds", {
      val: Math.round(Number(uptimeSeconds || 0)),
      ack: true,
      q: 0
    });
  }

  async mapSummary(index, id, featureName, propertyName, type, role, unit) {
    const property = index.get(featureName)?.properties?.[propertyName];
    if (!property) {
      return;
    }
    const value = normalizeValue(property.value ?? property);
    await this.ensureState(
      id,
      id.replaceAll(".", " "),
      type || stateType(value),
      role || "value",
      unit ?? property.unit
    );
    await this.adapter.setStateAsync(id, { val: value, ack: true });
  }

  async ensureState(id, name, type, role, unit) {
    await this.adapter.setObjectNotExistsAsync(id, {
      type: "state",
      common: {
        name,
        type,
        role,
        read: true,
        write: false,
        unit
      },
      native: {}
    });
  }
}
