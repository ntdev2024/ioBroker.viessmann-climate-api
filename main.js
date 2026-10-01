import path from "node:path";
import { fileURLToPath } from "node:url";

import * as utils from "@iobroker/adapter-core";
import { OAuthCallbackServer } from "./src/lib/http/oauth-server.js";
import { SerializedPollScheduler } from "./src/lib/runtime/poll-scheduler.js";
import { encryptNativePatch } from "./src/lib/security/native-config.js";
import { redactSensitiveText, safeErrorMessage as redactErrorMessage } from "./src/lib/security/redaction.js";
import { StateSync } from "./src/lib/state/state-sync.js";
import { donationLinkResponse } from "./src/lib/support/donation.js";
import { ViessmannClient } from "./src/lib/viessmann-client/client.js";
import { discoverEquipment } from "./src/lib/viessmann-client/discovery.js";
import {
  createAuthorizationUrl,
  exchangeAuthorizationCode,
  extractCodeAndState,
  normalizeScope,
  tokenNativePatch
} from "./src/lib/viessmann-client/oauth.js";
import { WriteQueue } from "./src/lib/write/write-queue.js";

export class ViessmannApiAdapter extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "viessmann-climate-api"
    });

    this.pollScheduler = null;
    this.oauthServer = null;
    this.pendingOAuth = null;
    this.oauthStopTimer = null;
    this.stateSync = new StateSync(this);
    this.missingTokenWarningLogged = false;
    this.unloading = false;
    this.lifecycleAbortController = new AbortController();

    this.on("ready", () => void this.onReady());
    this.on("message", message => void this.onMessage(message));
    this.on("stateChange", (id, state) => void this.onStateChange(id, state));
    this.on("unload", callback => void this.onUnload(callback));
  }

  logInfo(message) {
    if (this.unloading) {
      return;
    }
    this.log.info(`[${this.namespace}] ${this.redactSensitiveText(message)}`);
  }

  logWarn(message) {
    if (this.unloading) {
      return;
    }
    this.log.warn(`[${this.namespace}] ${this.redactSensitiveText(message)}`);
  }

  logError(message) {
    if (this.unloading) {
      return;
    }
    this.log.error(`[${this.namespace}] ${this.redactSensitiveText(message)}`);
  }

  sensitiveLogValues() {
    return [
      this.config?.clientSecret,
      this.config?.accessToken,
      this.config?.refreshToken,
      this.config?.oauthCode,
      this.config?.oauthPkceVerifier,
      this.client?.clientSecret,
      this.client?.accessToken,
      this.client?.refreshToken
    ];
  }

  redactSensitiveText(value) {
    return redactSensitiveText(value, { sensitiveValues: this.sensitiveLogValues() });
  }

  safeErrorMessage(error) {
    return redactErrorMessage(error, { sensitiveValues: this.sensitiveLogValues() });
  }

  async onReady() {
    if (this.unloading) {
      return;
    }
    this.validateConfig();
    await this.stateSync.ensureBaseStates();
    if (this.unloading) {
      return;
    }
    this.subscribeStates("write.command");
    this.subscribeStates("raw.devices.*.features.*.commands.*");
    this.subscribeStates("control.*");
    this.subscribeStates("writes.allowlist.*.enabled");
    this.subscribeStates("diagnostics.support.createReport");

    const requestTimestamps = await this.loadUsageTimestamps();
    if (this.unloading) {
      return;
    }
    this.client = new ViessmannClient({
      adapter: this,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      accessToken: this.config.accessToken,
      refreshToken: this.config.refreshToken,
      tokenExpiresAt: this.config.tokenExpiresAt,
      scope: this.config.scope,
      requestTimestamps,
      lifecycleSignal: this.lifecycleAbortController.signal
    });

    this.writeQueue = new WriteQueue({
      adapter: this,
      client: this.client,
      stateSync: this.stateSync,
      minIntervalMs: Number(this.config.minWriteIntervalSeconds || 30) * 1000
    });

    this.pollScheduler = new SerializedPollScheduler({
      adapter: this,
      poll: reason => this.pollOnce(reason),
      intervalMs: () => this.pollIntervalMs()
    });
    if (this.unloading) {
      await this.pollScheduler.stop();
      return;
    }
    await this.requestPoll("startup");
  }

  async onMessage(message) {
    if (this.unloading || !message?.command) {
      return;
    }

    try {
      if (message.command === "oauthCreateUrl") {
        await this.handleOauthCreateUrl(message);
        return;
      }
      if (message.command === "oauthExchangeCode") {
        await this.handleOauthExchangeCode(message);
        return;
      }
      if (message.command === "createSupportReport") {
        const report = await this.createSupportReport();
        this.reply(message, { report });
        return;
      }
      if (message.command === "openDonationUrl") {
        this.handleOpenDonationUrl(message);
      }
    } catch (error) {
      const safeMessage = this.safeErrorMessage(error);
      this.logWarn(`Admin command ${message.command} failed: ${safeMessage}`);
      this.reply(message, {
        error: safeMessage,
        native: {}
      });
    }
  }

  async handleOauthCreateUrl(message) {
    const data = message.message || {};
    const clientId = data.clientId || this.config.clientId;
    const redirectUri =
      data.oauthPublicRedirectUri || this.config.oauthPublicRedirectUri || data.redirectUri || this.config.redirectUri;
    const scope = normalizeScope(data.scope || this.config.scope);
    if (!clientId) {
      throw new Error("Missing Client ID.");
    }
    if (!redirectUri) {
      throw new Error("Missing Redirect URI.");
    }

    const auth = createAuthorizationUrl({ clientId, redirectUri, scope });
    this.pendingOAuth = {
      clientId,
      clientSecret: this.config.clientSecret || "",
      redirectUri,
      scope,
      verifier: auth.verifier,
      state: auth.state,
      loginUrl: auth.url,
      createdAt: new Date().toISOString()
    };
    Object.assign(this.config, {
      clientId,
      redirectUri,
      oauthPublicRedirectUri: redirectUri,
      scope
    });

    await this.startOAuthCallbackServer();
    this.logInfo("Viessmann OAuth login URL created.");
    const response = {
      url: auth.url,
      openUrl: auth.url,
      window: "_blank"
    };
    this.reply(message, response);
  }

  handleOpenDonationUrl(message) {
    this.reply(message, donationLinkResponse());
  }

  async startOAuthCallbackServer() {
    if (this.unloading || !this.config.oauthCallbackEnabled) {
      return;
    }
    if (!this.oauthServer) {
      this.oauthServer = new OAuthCallbackServer({
        adapter: this,
        bindAddress: this.config.bind || this.config.oauthCallbackBindAddress || "0.0.0.0",
        port: Number(this.config.port || this.config.oauthCallbackPort || 8097),
        path: this.config.oauthCallbackPath
      });
      this.oauthServer.start();
    }
    if (this.oauthStopTimer) {
      this.clearTimeout(this.oauthStopTimer);
    }
    this.oauthStopTimer = this.setTimeout(
      () => {
        void this.stopOAuthCallbackServer("OAuth callback endpoint stopped after login timeout.");
      },
      10 * 60 * 1000
    );
  }

  async stopOAuthCallbackServer(message) {
    if (this.oauthStopTimer) {
      this.clearTimeout(this.oauthStopTimer);
      this.oauthStopTimer = null;
    }
    if (!this.oauthServer) {
      return;
    }
    await this.oauthServer.stop();
    this.oauthServer = null;
    if (message) {
      this.logInfo(message);
    }
  }

  async persistTokenPatch(tokenPatch, reason) {
    if (!tokenPatch?.accessToken || !tokenPatch?.refreshToken) {
      this.logWarn(
        `OAuth token store not updated after ${reason}: accessTokenPresent=${tokenPatch?.accessToken ? "yes" : "no"}, refreshTokenPresent=${tokenPatch?.refreshToken ? "yes" : "no"}`
      );
      return;
    }

    Object.assign(this.config, tokenPatch);
    await this.persistNativePatch(tokenPatch);
    if (reason === "token refresh") {
      this.logInfo("Viessmann OAuth token refreshed and stored.");
    }
  }

  async persistNativePatch(native) {
    const encrypted = encryptNativePatch(native, value => this.encrypt(value));
    await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, { native: encrypted });
  }

  async handleOauthExchangeCode(message) {
    const data = message.message || {};
    const clientId = data.clientId || this.config.clientId;
    const clientSecret = data.clientSecret || this.config.clientSecret || "";
    const redirectUri =
      data.oauthActiveRedirectUri ||
      this.config.oauthActiveRedirectUri ||
      data.oauthPublicRedirectUri ||
      this.config.oauthPublicRedirectUri ||
      data.redirectUri ||
      this.config.redirectUri;
    const verifier = data.oauthPkceVerifier || this.config.oauthPkceVerifier;
    const expectedState = data.oauthPkceState || this.config.oauthPkceState || "";
    const { code, state } = extractCodeAndState(data.oauthCode);

    if (!clientId) {
      throw new Error("Missing Client ID.");
    }
    if (!redirectUri) {
      throw new Error("Missing Redirect URI.");
    }
    if (!verifier) {
      throw new Error("Missing PKCE verifier. Create a new login URL first.");
    }
    if (expectedState && state && state !== expectedState) {
      throw new Error("OAuth state does not match. Create a new login URL and try again.");
    }

    const tokens = await exchangeAuthorizationCode({
      clientId,
      clientSecret,
      redirectUri,
      code,
      verifier,
      signal: this.lifecycleAbortController.signal
    });

    const tokenPatch = tokenNativePatch(tokens);
    const native = {
      clientId,
      clientSecret,
      redirectUri,
      scope: normalizeScope(data.scope || this.config.scope),
      ...tokenPatch,
      oauthCode: "",
      oauthLoginUrl: "",
      oauthPkceVerifier: "",
      oauthPkceState: ""
    };

    await this.persistNativePatch(native);
    Object.assign(this.config, native);
    if (this.client) {
      this.client.clientId = native.clientId;
      this.client.clientSecret = native.clientSecret;
      this.client.accessToken = native.accessToken;
      this.client.refreshToken = native.refreshToken;
      this.client.tokenExpiresAt = native.tokenExpiresAt;
    }

    this.logInfo("Viessmann OAuth login succeeded.");
    this.reply(message, { success: true, accessTokenPresent: true, refreshTokenPresent: true });
    await this.requestPoll("oauth code exchange");
  }

  async completeOAuthCallback({ code, state }) {
    const pkceStore = this.pendingOAuth;
    const expectedState = pkceStore?.state || "";
    if (expectedState && state && state !== expectedState) {
      throw new Error("OAuth state does not match. Create a new login URL and try again.");
    }

    if (this.client?.hasTokens() || (this.config.accessToken && this.config.refreshToken)) {
      this.logInfo("Viessmann OAuth callback ignored because tokens already exist.");
      return;
    }

    const clientId = pkceStore?.clientId || this.config.clientId;
    const clientSecret = pkceStore?.clientSecret || this.config.clientSecret || "";
    const redirectUri = pkceStore?.redirectUri || this.config.oauthPublicRedirectUri || this.config.redirectUri;
    const verifier = pkceStore?.verifier;
    if (!clientId) {
      throw new Error("Missing Client ID.");
    }
    if (!redirectUri) {
      throw new Error("Missing Redirect URI.");
    }
    if (!verifier) {
      throw new Error("Missing PKCE verifier. Create a new login URL first.");
    }

    const tokens = await exchangeAuthorizationCode({
      clientId,
      clientSecret,
      redirectUri,
      code,
      verifier,
      signal: this.lifecycleAbortController.signal
    });

    const tokenPatch = tokenNativePatch(tokens);
    const native = {
      clientId,
      clientSecret,
      redirectUri,
      oauthPublicRedirectUri: this.config.oauthPublicRedirectUri,
      scope: normalizeScope(this.config.scope),
      ...tokenPatch,
      oauthCode: "",
      oauthLoginUrl: "",
      oauthPkceVerifier: "",
      oauthPkceState: "",
      oauthActiveRedirectUri: ""
    };

    await this.persistNativePatch(native);
    Object.assign(this.config, native);
    if (this.client) {
      this.client.clientId = native.clientId;
      this.client.clientSecret = native.clientSecret;
      this.client.accessToken = native.accessToken;
      this.client.refreshToken = native.refreshToken;
      this.client.tokenExpiresAt = native.tokenExpiresAt;
    }
    this.pendingOAuth = null;
    this.logInfo("Viessmann OAuth login succeeded.");
    await this.stopOAuthCallbackServer("OAuth callback endpoint stopped after successful login.");
    await this.requestPoll("oauth callback");
  }

  reply(message, payload) {
    if (!this.unloading && message.callback) {
      this.sendTo(message.from, message.command, payload, message.callback);
    }
  }

  validateConfig() {
    const interval = Number(this.config.pollIntervalMinutes || 5);
    if (interval < 2 || interval > 60) {
      throw new Error("pollIntervalMinutes must be between 2 and 60.");
    }
    const budget = Number(this.config.dailyRequestBudget || 1450);
    if (budget < 100 || budget > 1450) {
      throw new Error("dailyRequestBudget must be between 100 and 1450.");
    }
    if (!this.config.clientId) {
      this.logWarn("Missing Viessmann clientId. Adapter will not be able to poll.");
    }
  }

  pollIntervalMs() {
    return Number(this.config.pollIntervalMinutes || 5) * 60 * 1000;
  }

  async requestPoll(reason = "manual") {
    if (this.unloading) {
      return false;
    }
    return this.pollScheduler?.request(reason) ?? false;
  }

  async pollOnce() {
    if (this.unloading) {
      return false;
    }
    if (!this.client?.hasTokens()) {
      await this.setStateAsync("info.connection", { val: false, ack: true });
      if (!this.missingTokenWarningLogged) {
        this.logWarn("Missing Viessmann tokens. Complete OAuth before enabling polling.");
        this.missingTokenWarningLogged = true;
      }
      return true;
    }

    try {
      this.missingTokenWarningLogged = false;
      const devices = await discoverEquipment(this.client);
      if (this.unloading) {
        return false;
      }
      this.supportDevices = this.createSupportDeviceSnapshot(devices);
      this.writeQueue.setCommandIndex(devices);

      this.stateSync.beginControlRebuild();
      for (const device of devices) {
        for (const feature of device.features) {
          if (this.unloading) {
            return false;
          }
          await this.stateSync.syncFeature(device.deviceId, feature);
        }
      }
      if (this.unloading) {
        return false;
      }
      await this.stateSync.finishControlRebuild();
      await this.stateSync.syncSummary(devices);

      if (this.unloading) {
        return false;
      }
      const usage = this.client.getUsage(this.config.dailyRequestBudget);
      await this.stateSync.syncDiagnostics(usage);
      await this.stateSync.syncRuntimeDiagnostics(process.memoryUsage(), process.uptime());
      await this.setStateAsync("info.connection", { val: true, ack: true });
      return true;
    } catch (error) {
      if (!this.unloading) {
        await this.setStateAsync("info.connection", { val: false, ack: true });
        this.logWarn(`Viessmann poll failed: ${this.safeErrorMessage(error)}`);
      }
      return false;
    }
  }

  async onStateChange(id, state) {
    if (this.unloading || !state || state.ack) {
      return;
    }
    if (id.includes(".writes.allowlist.") && id.endsWith(".enabled")) {
      this.logInfo("Write allowlist changed. Rebuilding Viessmann control states.");
      await this.requestPoll("allowlist change");
      return;
    }
    if (id.endsWith(".diagnostics.support.createReport")) {
      await this.createSupportReport();
      await this.setStateAsync("diagnostics.support.createReport", { val: false, ack: true });
      return;
    }
    if (!id.endsWith(".write.command") && !id.includes(".commands.") && !id.includes(".control.")) {
      return;
    }
    if (!this.config.writeEnabled) {
      this.logWarn(`Write command ignored because writes are disabled: ${id}`);
      return;
    }
    try {
      const request = await this.writeRequestFromState(id, state.val);
      await this.writeQueue.enqueue(request, "state");
      await this.setForeignStateAsync(id, { val: state.val, ack: true, q: 0 });
    } catch (error) {
      const safeMessage = this.safeErrorMessage(error);
      await this.setStateAsync("write.lastResult", {
        val: JSON.stringify({ ok: false, error: safeMessage, at: new Date().toISOString() }),
        ack: true
      });
      this.logError(`Write command rejected: id=${id}, error=${safeMessage}`);
    }
  }

  async writeRequestFromState(id, value) {
    if (id.endsWith(".write.command")) {
      const request = typeof value === "string" ? JSON.parse(value) : value;
      if (!(await this.stateSync.isCommandEnabled(request.feature, request.command))) {
        throw new Error(`Command is not enabled in write allowlist: ${request.feature}:${request.command}`);
      }
      return request;
    }

    const object = await this.getForeignObjectAsync(id);
    const native = object?.native || {};
    if (!native.allowlisted) {
      throw new Error(`State is not allowlisted for writes: ${id}`);
    }

    return {
      deviceId: native.deviceId,
      feature: native.featureName,
      command: native.commandName,
      params: typeof value === "string" ? JSON.parse(value || "{}") : value
    };
  }

  async loadUsageTimestamps() {
    const state = await this.getStateAsync("diagnostics.api.limit.requestTimestampsJson");
    if (!state?.val) {
      return [];
    }
    try {
      const timestamps = JSON.parse(state.val);
      if (!Array.isArray(timestamps)) {
        return [];
      }
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return timestamps.map(value => Number(value)).filter(value => Number.isFinite(value) && value >= cutoff);
    } catch {
      return [];
    }
  }

  redactedConfig() {
    return {
      pollIntervalMinutes: Number(this.config.pollIntervalMinutes || 5),
      dailyRequestBudget: Number(this.config.dailyRequestBudget || 1450),
      writeEnabled: Boolean(this.config.writeEnabled),
      minWriteIntervalSeconds: Number(this.config.minWriteIntervalSeconds || 30),
      hasClientId: Boolean(this.config.clientId),
      hasClientSecret: Boolean(this.config.clientSecret),
      hasAccessToken: Boolean(this.config.accessToken),
      hasRefreshToken: Boolean(this.config.refreshToken),
      tokenExpiresAt: Number(this.config.tokenExpiresAt || 0)
    };
  }

  redactUri(uri) {
    return String(uri || "")
      .replace(/installations\/[^/]+/g, "installations/<redacted>")
      .replace(/gateways\/[^/]+/g, "gateways/<redacted>")
      .replace(/devices\/[^/]+/g, "devices/<deviceId>");
  }

  sanitizeFeature(feature) {
    const featureName = feature.feature || feature.name || "";
    const properties = {};
    for (const [propertyName, property] of Object.entries(feature.properties || {})) {
      properties[propertyName] = {
        type: typeof (property?.value ?? property),
        unit: property?.unit || "",
        status: property?.status || "",
        hasValue: property?.value !== undefined
      };
    }
    const commands = {};
    for (const [commandName, command] of Object.entries(feature.commands || {})) {
      commands[commandName] = {
        executable: Boolean(command?.isExecutable),
        params: command?.params || {},
        uri: this.redactUri(command?.uri)
      };
    }
    return {
      feature: featureName,
      enabled: Boolean(feature.isEnabled),
      ready: Boolean(feature.isReady),
      properties,
      commands
    };
  }

  createSupportDeviceSnapshot(devices) {
    return (devices || []).map(device => ({
      deviceId: String(device.deviceId || ""),
      featureCount: (device.features || []).length,
      features: (device.features || []).map(feature => this.sanitizeFeature(feature))
    }));
  }

  async createSupportReport() {
    const devices = this.supportDevices || [];
    const usage = this.client?.getUsage(this.config.dailyRequestBudget) || {
      used: 0,
      remaining: Number(this.config.dailyRequestBudget || 1450),
      headers: {}
    };
    const adapterObject = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
    const report = {
      createdAt: new Date().toISOString(),
      adapter: {
        namespace: this.namespace,
        version: adapterObject?.common?.version || "",
        node: process.version,
        platform: process.platform,
        arch: process.arch
      },
      config: this.redactedConfig(),
      apiUsage: usage,
      memory: process.memoryUsage(),
      devices
    };
    const value = JSON.stringify(report);
    await this.setStateAsync("diagnostics.support.report", { val: value, ack: true, q: 0 });
    await this.setStateAsync("diagnostics.support.lastCreatedAt", { val: report.createdAt, ack: true, q: 0 });
    this.logInfo("Viessmann support report created.");
    return value;
  }

  async onUnload(callback) {
    this.unloading = true;
    try {
      if (!this.lifecycleAbortController.signal.aborted) {
        this.lifecycleAbortController.abort(new Error("Adapter is unloading."));
      }
      this.client?.stop();
      const cleanup = [this.stopOAuthCallbackServer()];
      if (this.writeQueue) {
        cleanup.push(this.writeQueue.stop());
      }
      if (this.pollScheduler) {
        cleanup.push(this.pollScheduler.stop());
      }
      await Promise.allSettled(cleanup);
      callback();
    } catch {
      callback();
    }
  }
}

export function startAdapter(options = {}) {
  return new ViessmannApiAdapter(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  startAdapter();
}

export default startAdapter;
