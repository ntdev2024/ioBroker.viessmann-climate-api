import test from "node:test";
import assert from "node:assert/strict";

import { SerializedPollScheduler } from "../src/lib/runtime/poll-scheduler.js";

function createScheduler(poll) {
  const scheduledDelays = [];
  const clearedTimers = [];
  const adapter = {
    setTimeout: (_callback, delay) => {
      scheduledDelays.push(delay);
      return { id: scheduledDelays.length };
    },
    clearTimeout: timer => clearedTimers.push(timer.id)
  };
  const scheduler = new SerializedPollScheduler({
    adapter,
    poll,
    intervalMs: () => 2 * 60 * 1000
  });
  return { scheduler, scheduledDelays, clearedTimers };
}

test("poll scheduler serializes overlapping poll requests", async () => {
  let activePolls = 0;
  let maximumActivePolls = 0;
  let finishPoll;
  const { scheduler, scheduledDelays } = createScheduler(async () => {
    activePolls += 1;
    maximumActivePolls = Math.max(maximumActivePolls, activePolls);
    await new Promise(resolve => {
      finishPoll = resolve;
    });
    activePolls -= 1;
    return true;
  });

  const first = scheduler.request("first");
  const second = scheduler.request("second");
  await new Promise(resolve => setImmediate(resolve));
  finishPoll();
  await Promise.all([first, second]);

  assert.equal(maximumActivePolls, 1);
  assert.deepEqual(scheduledDelays, [0]);
});

test("poll scheduler applies exponential backoff after failures", async () => {
  const { scheduler, scheduledDelays } = createScheduler(async () => false);

  await scheduler.request("failure");

  assert.equal(scheduler.failureCount, 1);
  assert.deepEqual(scheduledDelays, [4 * 60 * 1000]);
});

test("poll scheduler stop clears timers and prevents follow-up polls", async () => {
  let finishPoll;
  let pollCount = 0;
  const { scheduler, scheduledDelays, clearedTimers } = createScheduler(async () => {
    pollCount += 1;
    await new Promise(resolve => {
      finishPoll = resolve;
    });
    return true;
  });

  scheduler.schedule(1000);
  const request = scheduler.request("manual");
  await new Promise(resolve => setImmediate(resolve));
  const stopped = scheduler.stop();
  finishPoll();
  await Promise.all([request, stopped]);

  assert.equal(pollCount, 1);
  assert.deepEqual(scheduledDelays, [1000]);
  assert.deepEqual(clearedTimers, [1]);
  assert.equal(await scheduler.request("after stop"), false);
});
