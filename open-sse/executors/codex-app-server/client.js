import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import { isString } from "../../../src/shared/utils/typeChecks.js";

const ENV = process.env;
const TOOL_CALL_METHOD = "item/tool/call";
// Prompts that gate codex's own host execution (not harness tools); denied unless the operator opts in.
const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
]);

const clean = (value) => (isString(value) && value.trim() ? value.trim() : null);

function readTokenFile(file) {
  try {
    return clean(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Operator-only configuration from the environment. Connection rows never
 * supply the URL or token, so no stored data can redirect the capability token.
 */
export function resolveAppServerConfig() {
  const url = clean(ENV.DURINDOOR_CODEX_APPSERVER_WS);
  if (!url || !/^wss?:\/\//.test(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  const token = clean(ENV.DURINDOOR_CODEX_APPSERVER_WS_TOKEN) ||
    (clean(ENV.DURINDOOR_CODEX_APPSERVER_WS_TOKEN_FILE) && readTokenFile(ENV.DURINDOOR_CODEX_APPSERVER_WS_TOKEN_FILE));
  if (!token) return null;
  return {
    url,
    token,
    cwd: clean(ENV.DURINDOOR_CODEX_APPSERVER_CWD) || "/tmp",
    approvalPolicy: clean(ENV.DURINDOOR_CODEX_APPSERVER_APPROVAL),
    sandbox: clean(ENV.DURINDOOR_CODEX_APPSERVER_SANDBOX),
    autoApprove: ["true", "1", "yes"].includes(clean(ENV.DURINDOOR_CODEX_APPSERVER_AUTO_APPROVE)),
  };
}

// Defaults keep codex from blocking on its own approvals while confining its own host execution.
export function resolveTurnPolicy(config) {
  return {
    approvalPolicy: config.approvalPolicy || "never",
    sandbox: config.sandbox || "workspace-write",
    autoApprove: config.autoApprove === true,
  };
}

/** Id-correlated JSON-RPC 2.0 client over one WebSocket. */
export class CodexAppServerClient {
  constructor({ webSocketFactory = null, defaultTimeoutMs = 120000, autoApprove = false } = {}) {
    this.webSocketFactory = webSocketFactory;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.autoApprove = autoApprove === true;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.notificationHandler = () => {};
    this.toolCallHandler = null;
  }

  connect(url, token) {
    const options = { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 15000 };
    const ws = this.webSocketFactory ? this.webSocketFactory(url, options) : new WebSocket(url, options);
    this.ws = ws;
    return new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", (error) => {
        reject(error);
        this.failAll(error.message);
      });
      ws.on("message", (raw) => this.onFrame(raw));
      ws.on("close", () => this.failAll("app-server connection closed"));
    });
  }

  request(method, params, timeoutMs = this.defaultTimeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.ws || this.closed) {
        reject(new Error(`Cannot send ${method}: app-server connection is not open`));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method, params) {
    if (this.ws && !this.closed) this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  onNotification(fn) {
    this.notificationHandler = fn;
  }

  onToolCall(fn) {
    this.toolCallHandler = fn;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws?.close(1000, "done");
    } catch {
      // Socket close race.
    }
    this.failAll("app-server client closed");
  }

  reply(payload) {
    if (this.ws && !this.closed) this.ws.send(JSON.stringify({ jsonrpc: "2.0", ...payload }));
  }

  onFrame(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const hasId = msg.id !== undefined && msg.id !== null;
    const hasMethod = isString(msg.method);
    if (hasId && !hasMethod) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(`${msg.error.code ?? "error"}: ${msg.error.message ?? "unknown"}`));
      else pending.resolve(msg.result);
    } else if (hasMethod && hasId) {
      // Every server request must be answered or the turn stalls.
      if (msg.method === TOOL_CALL_METHOD && this.toolCallHandler) {
        this.toolCallHandler(msg.id, msg.params, {
          respond: (result) => this.reply({ id: msg.id, result }),
          respondError: (code, message) => this.reply({ id: msg.id, error: { code, message } }),
        });
      } else if (APPROVAL_METHODS.has(msg.method)) {
        this.reply({ id: msg.id, result: { decision: this.autoApprove ? "approved" : "denied" } });
      } else {
        this.reply({ id: msg.id, error: { code: -32601, message: `router: unsupported server request "${msg.method}"` } });
      }
    } else if (hasMethod) {
      this.notificationHandler(msg.method, msg.params);
    }
  }

  failAll(reason) {
    const error = new Error(reason);
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
    if (!this.closed) this.notificationHandler("__transport_closed__", { reason });
  }
}
