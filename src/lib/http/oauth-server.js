import http from "node:http";
import { safeErrorMessage } from "../security/redaction.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class OAuthCallbackServer {
  constructor({ adapter, bindAddress, port, path }) {
    this.adapter = adapter;
    this.bindAddress = bindAddress || "0.0.0.0";
    this.port = Number(port || 8097);
    this.path = path || "/callback";
    this.server = null;
  }

  start() {
    if (this.server) {
      return;
    }
    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.listen(this.port, this.bindAddress, () => {
      this.adapter.logInfo(`OAuth callback endpoint listening on ${this.bindAddress}:${this.port}${this.path}`);
    });
  }

  stop() {
    if (!this.server) {
      return Promise.resolve();
    }
    const server = this.server;
    this.server = null;
    server.closeAllConnections?.();
    return new Promise(resolve => server.close(() => resolve()));
  }

  async handle(request, response) {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      this.adapter.logOauthDebug?.(
        `callback HTTP request received: method=${request.method}, path=${url.pathname}, remote=${request.socket?.remoteAddress || "unknown"}`
      );
      if (request.method !== "GET" || url.pathname !== this.path) {
        this.send(response, 404, "Viessmann OAuth callback endpoint not found.");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const description = url.searchParams.get("error_description") || error;
        throw new Error(description);
      }

      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const maskedCode =
        typeof this.adapter.maskSecret === "function"
          ? this.adapter.maskSecret(code)
          : `${code ? "present" : "missing"}`;
      this.adapter.logOauthDebug?.(`callback query parsed: code=${maskedCode}, state=${state || "<empty>"}`);
      if (!code) {
        throw new Error("Callback has no OAuth code.");
      }

      await this.adapter.completeOAuthCallback({ code, state });
      this.send(response, 200, "Viessmann OAuth login succeeded. You can close this browser tab.");
    } catch (error) {
      const safeMessage =
        typeof this.adapter.safeErrorMessage === "function"
          ? this.adapter.safeErrorMessage(error)
          : safeErrorMessage(error);
      this.adapter.logWarn(`OAuth callback failed: ${safeMessage}`);
      this.send(response, 400, `Viessmann OAuth login failed: ${safeMessage}`);
    }
  }

  send(response, status, message) {
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><html><head><title>Viessmann OAuth</title></head><body><h1>${escapeHtml(message)}</h1></body></html>`
    );
  }
}
