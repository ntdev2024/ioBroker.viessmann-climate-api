export class SerializedPollScheduler {
  constructor({ adapter, poll, intervalMs, maxBackoffMs = 60 * 60 * 1000 }) {
    this.adapter = adapter;
    this.poll = poll;
    this.intervalMs = intervalMs;
    this.maxBackoffMs = maxBackoffMs;
    this.timer = null;
    this.promise = null;
    this.rerunRequested = false;
    this.failureCount = 0;
    this.stopped = false;
  }

  normalDelayMs() {
    return Math.max(0, Number(this.intervalMs() || 0));
  }

  failureDelayMs() {
    const exponent = Math.min(this.failureCount, 4);
    return Math.min(this.normalDelayMs() * 2 ** exponent, this.maxBackoffMs);
  }

  clearTimer() {
    if (this.timer) {
      this.adapter.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  schedule(delayMs) {
    if (this.stopped) {
      return;
    }
    this.clearTimer();
    this.timer = this.adapter.setTimeout(
      () => {
        this.timer = null;
        void this.request("scheduled");
      },
      Math.max(0, Number(delayMs || 0))
    );
  }

  async request(reason = "manual") {
    if (this.stopped) {
      return false;
    }
    if (this.promise) {
      this.rerunRequested = true;
      return this.promise;
    }

    this.clearTimer();
    let succeeded = false;
    this.promise = this.poll(reason);
    try {
      succeeded = await this.promise;
      this.failureCount = succeeded ? 0 : this.failureCount + 1;
      return succeeded;
    } finally {
      this.promise = null;
      if (!this.stopped) {
        const rerunRequested = this.rerunRequested;
        this.rerunRequested = false;
        this.schedule(rerunRequested ? 0 : succeeded ? this.normalDelayMs() : this.failureDelayMs());
      }
    }
  }

  async stop() {
    this.stopped = true;
    this.rerunRequested = false;
    this.clearTimer();
    if (this.promise) {
      await this.promise;
    }
  }
}
