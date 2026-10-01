import { TOKEN_URL } from "./oauth.js";
import { redactSensitiveText, safeErrorMessage } from "../security/redaction.js";

const API_BASE = "https://api.viessmann-climatesolutions.com";
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function toJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export class ViessmannClient {
  constructor({
    adapter,
    clientId,
    clientSecret,
    accessToken,
    refreshToken,
    tokenExpiresAt,
    scope,
    requestTimestamps = [],
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    lifecycleSignal
  }) {
    this.adapter = adapter;
    this.clientId = clientId;
    this.clientSecret = clientSecret || "";
    this.accessToken = accessToken || "";
    this.refreshToken = refreshToken || "";
    this.tokenExpiresAt = Number(tokenExpiresAt || 0);
    this.scope = scope || "IoT User";
    this.requestTimestamps = Array.isArray(requestTimestamps) ? requestTimestamps : [];
    this.requestTimeoutMs = Number(requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
    this.lifecycleSignal = lifecycleSignal;
    this.lastHeaders = {};
    this.activeControllers = new Set();
    this.stopped = false;
  }

  ensureActive() {
    if (this.stopped || this.lifecycleSignal?.aborted) {
      throw new Error("Viessmann client stopped because the adapter is unloading.");
    }
  }

  stop() {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    for (const controller of this.activeControllers) {
      controller.abort(new Error("Adapter is unloading."));
    }
    this.activeControllers.clear();
  }

  hasTokens() {
    return Boolean(this.accessToken && this.refreshToken);
  }

  getUsage(dailyBudget) {
    this.pruneUsage();
    const used = this.requestTimestamps.length;
    return {
      used,
      remaining: Math.max(0, Number(dailyBudget || 1450) - used),
      headers: this.lastHeaders
    };
  }

  async refreshIfNeeded() {
    this.ensureActive();
    if (!this.refreshToken) {
      throw new Error("Missing Viessmann refresh token.");
    }
    if (this.accessToken && this.tokenExpiresAt > Date.now() + 60_000) {
      return;
    }

    this.adapter.logInfo("Refreshing Viessmann OAuth token.");
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId,
      refresh_token: this.refreshToken
    });
    if (this.clientSecret) {
      form.set("client_secret", this.clientSecret);
    }

    const body = await this.fetchRaw(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });
    this.ensureActive();

    this.accessToken = body.access_token;
    this.refreshToken = body.refresh_token || this.refreshToken;
    this.tokenExpiresAt = Date.now() + Number(body.expires_in || 0) * 1000;

    const tokenPatch = {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      tokenExpiresAt: this.tokenExpiresAt,
      oauthTokenCreatedAt: new Date().toISOString()
    };
    if (typeof this.adapter.persistTokenPatch === "function") {
      await this.adapter.persistTokenPatch(tokenPatch, "token refresh");
    } else {
      await this.adapter.extendForeignObjectAsync(`system.adapter.${this.adapter.namespace}`, { native: tokenPatch });
    }
  }

  async get(pathname) {
    this.ensureActive();
    await this.refreshIfNeeded();
    return this.fetchApi(pathname, { method: "GET" });
  }

  async post(pathname, payload) {
    this.ensureActive();
    await this.refreshIfNeeded();
    return this.fetchApi(pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
  }

  async fetchApi(pathname, options) {
    this.ensureActive();
    const url = `${API_BASE}${pathname}`;
    return this.fetchRaw(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${this.accessToken}`
      }
    });
  }

  async fetchRaw(url, options) {
    this.ensureActive();
    const requestController = new AbortController();
    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const { signal: callerSignal, ...fetchOptions } = options || {};
    const signals = [requestController.signal, timeoutSignal];
    if (callerSignal) {
      signals.push(callerSignal);
    }
    if (this.lifecycleSignal) {
      signals.push(this.lifecycleSignal);
    }
    this.activeControllers.add(requestController);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: AbortSignal.any(signals)
      });
      this.ensureActive();
      this.trackRequest(response.headers);
      const text = await response.text();
      const body = toJson(text);
      if (!response.ok) {
        const safeBody = redactSensitiveText(JSON.stringify(body), {
          sensitiveValues: [this.clientSecret, this.accessToken, this.refreshToken]
        });
        throw new Error(`Viessmann request failed: HTTP ${response.status} ${safeBody}`);
      }
      return body;
    } catch (error) {
      if (this.stopped || this.lifecycleSignal?.aborted) {
        throw new Error("Viessmann request aborted because the adapter is unloading.");
      }
      if (timeoutSignal.aborted) {
        throw new Error(`Viessmann request timed out after ${this.requestTimeoutMs} ms.`);
      }
      throw new Error(
        safeErrorMessage(error, {
          sensitiveValues: [this.clientSecret, this.accessToken, this.refreshToken]
        }),
        { cause: error }
      );
    } finally {
      this.activeControllers.delete(requestController);
    }
  }

  trackRequest(headers) {
    if (this.stopped || this.lifecycleSignal?.aborted) {
      return;
    }
    this.requestTimestamps.push(Date.now());
    this.pruneUsage();
    void this.adapter.setStateAsync("diagnostics.api.limit.requestTimestampsJson", {
      val: JSON.stringify(this.requestTimestamps),
      ack: true,
      q: 0
    });
    this.lastHeaders = {
      limit: headers.get("x-rate-limit-limit") || headers.get("x-ratelimit-limit") || "",
      remaining: headers.get("x-rate-limit-remaining") || headers.get("x-ratelimit-remaining") || "",
      reset: headers.get("x-rate-limit-reset") || headers.get("x-ratelimit-reset") || ""
    };
  }

  pruneUsage() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.requestTimestamps = this.requestTimestamps.filter(timestamp => timestamp >= cutoff);
  }
}
