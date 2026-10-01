import { commandKey } from "./allowlist.js";
import { commandPath } from "../viessmann-client/discovery.js";
import { safeErrorMessage } from "../security/redaction.js";

export class WriteQueue {
  constructor({ adapter, client, stateSync, minIntervalMs = 30_000 }) {
    this.adapter = adapter;
    this.client = client;
    this.stateSync = stateSync;
    this.minIntervalMs = minIntervalMs;
    this.queue = [];
    this.processing = false;
    this.processPromise = null;
    this.lastWriteAt = 0;
    this.commandIndex = new Map();
    this.waitTimer = null;
    this.waitResolve = null;
    this.stopped = false;
  }

  setCommandIndex(devices) {
    this.commandIndex.clear();
    for (const device of devices) {
      for (const feature of device.features || []) {
        const featureName = feature.feature || feature.name;
        for (const [commandName, command] of Object.entries(feature.commands || {})) {
          const key = `${device.deviceId}:${commandKey(featureName, commandName)}`;
          this.commandIndex.set(key, { featureName, commandName, command });
        }
      }
    }
  }

  safeErrorMessage(error) {
    if (typeof this.adapter.safeErrorMessage === "function") {
      return this.adapter.safeErrorMessage(error);
    }
    return safeErrorMessage(error, {
      sensitiveValues: [this.client.clientSecret, this.client.accessToken, this.client.refreshToken]
    });
  }

  async enqueue(request, source = "state") {
    if (this.stopped) {
      throw new Error("Write queue is stopped.");
    }
    const normalized = await this.normalizeRequest(request);
    if (this.stopped) {
      throw new Error("Write queue is stopped.");
    }
    this.queue.push({ ...normalized, source, queuedAt: new Date().toISOString() });
    void this.adapter.setStateAsync("write.queueLength", { val: this.queue.length, ack: true });
    this.adapter.logInfo(
      `Viessmann write queued: source=${source}, deviceId=${normalized.deviceId}, feature=${normalized.feature}, command=${normalized.command}, queueLength=${this.queue.length}`
    );
    if (!this.processPromise) {
      this.processPromise = this.process()
        .catch(error => {
          if (!this.stopped) {
            this.adapter.logError(`Viessmann write queue failed: ${this.safeErrorMessage(error)}`);
          }
        })
        .finally(() => {
          this.processPromise = null;
        });
    }
    return normalized;
  }

  wait(waitMs) {
    return new Promise(resolve => {
      this.waitResolve = resolve;
      this.waitTimer = this.adapter.setTimeout(() => {
        this.waitTimer = null;
        this.waitResolve = null;
        resolve();
      }, waitMs);
    });
  }

  async stop() {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.queue.length = 0;
    if (this.waitTimer) {
      this.adapter.clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      resolve();
    }
    if (this.processPromise) {
      await this.processPromise;
    }
  }

  async normalizeRequest(request) {
    if (!request || typeof request !== "object") {
      throw new Error("Write request must be an object.");
    }
    const deviceId = String(request.deviceId ?? "0");
    const feature = String(request.feature || "");
    const command = String(request.command || "");
    if (!feature || !command) {
      throw new Error("Write request needs feature and command.");
    }
    if (!(await this.stateSync.isCommandEnabled(feature, command))) {
      throw new Error(`Command is not enabled in write allowlist: ${feature}:${command}`);
    }
    const entry = this.commandIndex.get(`${deviceId}:${commandKey(feature, command)}`);
    if (!entry?.command?.isExecutable) {
      throw new Error(`Command is not executable according to discovery: ${feature}:${command}`);
    }
    return {
      deviceId,
      feature,
      command,
      params: request.params || {},
      entry
    };
  }

  async process() {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      while (!this.stopped && this.queue.length > 0) {
        const waitMs = Math.max(0, this.minIntervalMs - (Date.now() - this.lastWriteAt));
        if (waitMs > 0) {
          await this.wait(waitMs);
        }
        if (this.stopped) {
          break;
        }
        const item = this.queue.shift();
        try {
          await this.execute(item);
        } catch (error) {
          if (this.stopped) {
            break;
          }
          const safeMessage = this.safeErrorMessage(error);
          await this.adapter.setStateAsync("write.lastResult", {
            val: JSON.stringify({
              ok: false,
              source: item.source,
              feature: item.feature,
              command: item.command,
              at: new Date().toISOString(),
              error: safeMessage
            }),
            ack: true
          });
          this.adapter.logError(
            `Viessmann write failed: source=${item.source}, deviceId=${item.deviceId}, feature=${item.feature}, command=${item.command}, error=${safeMessage}`
          );
        }
        if (!this.stopped) {
          await this.adapter.setStateAsync("write.queueLength", { val: this.queue.length, ack: true });
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async execute(item) {
    if (this.stopped) {
      return;
    }
    const pathname = commandPath(item.entry.command);
    this.adapter.logInfo(
      `Viessmann write executing: source=${item.source}, deviceId=${item.deviceId}, feature=${item.feature}, command=${item.command}`
    );
    const result = await this.client.post(pathname, item.params);
    if (this.stopped) {
      return;
    }
    this.lastWriteAt = Date.now();
    await this.adapter.setStateAsync("write.lastResult", {
      val: JSON.stringify({
        ok: true,
        source: item.source,
        feature: item.feature,
        command: item.command,
        at: new Date().toISOString(),
        result
      }),
      ack: true
    });
    await this.stateSync.updateControlCurrentAfterWrite(item.feature, item.params);
    this.adapter.logInfo(
      `Viessmann write succeeded: source=${item.source}, deviceId=${item.deviceId}, feature=${item.feature}, command=${item.command}`
    );
  }
}
