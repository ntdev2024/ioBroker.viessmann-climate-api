import test from "node:test";
import assert from "node:assert/strict";

import { WriteQueue } from "../src/lib/write/write-queue.js";

function createHarness({ enabled = true, executable = true, minIntervalMs = 0 } = {}) {
  const states = [];
  const logs = [];
  const posts = [];
  const currentUpdates = [];
  const adapter = {
    setStateAsync: async (id, state) => states.push({ id, state }),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: timer => clearTimeout(timer),
    logInfo: message => logs.push({ level: "info", message }),
    logError: message => logs.push({ level: "error", message })
  };
  const client = {
    post: async (path, params) => {
      posts.push({ path, params });
      return { accepted: true };
    }
  };
  const stateSync = {
    isCommandEnabled: async () => enabled,
    updateControlCurrentAfterWrite: async (feature, params) => currentUpdates.push({ feature, params })
  };
  const queue = new WriteQueue({ adapter, client, stateSync, minIntervalMs });
  queue.setCommandIndex([
    {
      deviceId: "0",
      features: [
        {
          feature: "heating.dhw.temperature.main",
          commands: {
            setTargetTemperature: {
              isExecutable: executable,
              uri: "https://api.viessmann-climatesolutions.com/iot/v2/features/installations/example/gateways/example/devices/0/features/heating.dhw.temperature.main/commands/setTargetTemperature"
            }
          }
        }
      ]
    }
  ]);
  return { adapter, client, stateSync, queue, states, logs, posts, currentUpdates };
}

test("normalizeRequest accepts enabled executable commands", async () => {
  const { queue } = createHarness();

  const normalized = await queue.normalizeRequest({
    feature: "heating.dhw.temperature.main",
    command: "setTargetTemperature",
    params: { temperature: 50 }
  });

  assert.equal(normalized.deviceId, "0");
  assert.equal(normalized.feature, "heating.dhw.temperature.main");
  assert.equal(normalized.command, "setTargetTemperature");
  assert.deepEqual(normalized.params, { temperature: 50 });
});

test("normalizeRequest rejects invalid requests", async () => {
  const { queue } = createHarness();

  await assert.rejects(() => queue.normalizeRequest(null), /must be an object/);
  await assert.rejects(() => queue.normalizeRequest({ feature: "x" }), /needs feature and command/);
});

test("normalizeRequest rejects disabled allowlist command", async () => {
  const { queue } = createHarness({ enabled: false });

  await assert.rejects(
    () =>
      queue.normalizeRequest({
        feature: "heating.dhw.temperature.main",
        command: "setTargetTemperature"
      }),
    /not enabled in write allowlist/
  );
});

test("normalizeRequest rejects non-executable discovered command", async () => {
  const { queue } = createHarness({ executable: false });

  await assert.rejects(
    () =>
      queue.normalizeRequest({
        feature: "heating.dhw.temperature.main",
        command: "setTargetTemperature"
      }),
    /not executable according to discovery/
  );
});

test("execute posts to discovered command path and updates result states", async () => {
  const { queue, posts, states, currentUpdates } = createHarness();
  const item = await queue.normalizeRequest({
    feature: "heating.dhw.temperature.main",
    command: "setTargetTemperature",
    params: { temperature: 48 }
  });

  await queue.execute({ ...item, source: "test" });

  assert.equal(posts.length, 1);
  assert.equal(
    posts[0].path,
    "/iot/v2/features/installations/example/gateways/example/devices/0/features/heating.dhw.temperature.main/commands/setTargetTemperature"
  );
  assert.deepEqual(posts[0].params, { temperature: 48 });
  assert.equal(states.at(-1).id, "write.lastResult");
  assert.equal(JSON.parse(states.at(-1).state.val).ok, true);
  assert.deepEqual(currentUpdates, [{ feature: "heating.dhw.temperature.main", params: { temperature: 48 } }]);
});

test("stop cancels a delayed write without post-unload state changes or logs", async () => {
  const { queue, posts, states, logs } = createHarness({ minIntervalMs: 60_000 });
  queue.lastWriteAt = Date.now();

  await queue.enqueue(
    {
      feature: "heating.dhw.temperature.main",
      command: "setTargetTemperature",
      params: { temperature: 47 }
    },
    "test"
  );
  const stateCountBeforeStop = states.length;
  const logCountBeforeStop = logs.length;

  await queue.stop();

  assert.equal(posts.length, 0);
  assert.equal(states.length, stateCountBeforeStop);
  assert.equal(logs.length, logCountBeforeStop);
  await assert.rejects(
    () =>
      queue.enqueue({
        feature: "heating.dhw.temperature.main",
        command: "setTargetTemperature"
      }),
    /stopped/
  );
});

test("failed writes redact credentials in result states and logs", async () => {
  const tokenMarker = "eyJhbGciOiJIUzI1NiJ9.release-marker.signature";
  const { queue, client, states, logs } = createHarness();
  client.accessToken = tokenMarker;
  client.refreshToken = "refresh-release-marker";
  client.post = async () => {
    throw new Error(`Authorization: Bearer ${tokenMarker}`);
  };
  const item = await queue.normalizeRequest({
    feature: "heating.dhw.temperature.main",
    command: "setTargetTemperature",
    params: { temperature: 48 }
  });
  queue.queue.push({ ...item, source: "test" });

  await queue.process();

  const result = JSON.parse(states.find(entry => entry.id === "write.lastResult").state.val);
  assert.equal(result.ok, false);
  assert.equal(result.error.includes(tokenMarker), false);
  assert.match(result.error, /\[REDACTED\]/);
  assert.equal(
    logs.some(entry => entry.message.includes(tokenMarker)),
    false
  );
});
