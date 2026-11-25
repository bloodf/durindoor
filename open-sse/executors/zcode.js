// ZCode local app-server executor (staged, unverified against a live runtime).
//
// Drives one text-only turn per request over the ZCode V4 stdio NDJSON protocol
// (one JSON message per LF-delimited frame, commands through `v4/command`,
// results read from the `conversation/<sessionId>` projection). Contract
// reference: internal/docs/zcode-v4-compatibility-1252.md. Registration and
// session shape follow OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878), open-sse/executors/zcode.ts and
// open-sse/config/providers/registry/zcode/index.ts; the binary transport that
// upstream fixture uses is NOT ported.
//
// Safety posture:
//  - Dispatch is off unless the connection sets
//    `providerSpecificData.enableSessionDispatch === true`.
//  - Every session is created tool-disabled (`toolDenylist`, no MCP servers) and
//    every turn repeats the denylist. The pinned V4 schema does not prove the
//    runtime enforces it, so any tool row or tool event the runtime still emits
//    ends the turn with an error and stops the session.
//  - The child process gets an allowlisted environment and a scratch working
//    directory; connection data can never choose the executable.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { BaseExecutor } from "./base.js";
import { bindsConnectionRoute, abortable, createExecutorSender, requestAbortError } from "./sendRequest.js";
import { settleProviderAttemptDispatch, transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { buildErrorBody } from "../utils/error.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

export const ZCODE_URL = "zcode://app-server/stdio";
export const ZCODE_OPT_IN_KEY = "enableSessionDispatch";
export const ZCODE_TOOL_DENYLIST = Object.freeze(["*"]);
export const ZCODE_METHODS = Object.freeze({
  command: "v4/command",
  subscribe: "v4/conversation/subscribe",
  unsubscribe: "v4/conversation/unsubscribe",
  frame: "v4/conversation/frame",
});
const ENV_ALLOWLIST = ["PATH", "HOME", "USERPROFILE", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT"];
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TURN_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_CONCURRENT = 4;
const TERMINAL_PHASES = new Set(["completedSuccess", "completedInterrupted", "error"]);
const TOOL_ROW_KINDS = new Set(["toolCall", "subagent"]);

export class ZcodeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ZcodeError";
    this.status = status;
    this.code = code;
  }
}

/** One line, bounded, no local home paths. */
function clean(value) {
  const home = os.homedir();
  let text = String(value || "ZCode error").split("\n")[0].slice(0, 300);
  if (home && home.length > 1) text = text.split(home).join("~");
  return text;
}

export function isZcodeDispatchEnabled(credentials) {
  return credentials?.providerSpecificData?.[ZCODE_OPT_IN_KEY] === true;
}

export function resolveZcodeModel(model) {
  const requested = isString(model) ? model.trim() : "";
  const name = requested.startsWith("zcode/") ? requested.slice("zcode/".length) : requested;
  if (!name) throw new ZcodeError(400, "zcode_invalid_model", "A ZCode model id is required.");
  if (name.startsWith("-") || /[\s\0]/.test(name)) {
    throw new ZcodeError(400, "zcode_invalid_model", `Invalid ZCode model "${clean(requested)}".`);
  }
  return name;
}

function textOf(content) {
  if (content == null) return "";
  if (isString(content)) return content;
  if (!Array.isArray(content)) throw new ZcodeError(400, "zcode_text_only", "ZCode accepts text content only.");
  return content.map((part) => {
    if (isString(part)) return part;
    if (isObject(part) && ["text", "input_text", "output_text"].includes(part.type) && isString(part.text)) return part.text;
    throw new ZcodeError(400, "zcode_text_only", "ZCode accepts text content only; images and files are not supported.");
  }).join("");
}

/** Stateless history flattened into one text turn. Request tools are refused. */
export function buildZcodePrompt(body) {
  if (Array.isArray(body?.tools) && body.tools.length && body.tool_choice !== "none") {
    throw new ZcodeError(400, "zcode_tools_unsupported", "ZCode sessions run with tools disabled; remove `tools` from the request.");
  }
  const labels = { system: "System", developer: "System", assistant: "Assistant" };
  const lines = [];
  for (const message of Array.isArray(body?.messages) ? body.messages : []) {
    if (!isObject(message)) continue;
    if (message.role === "tool" || (Array.isArray(message.tool_calls) && message.tool_calls.length)) {
      throw new ZcodeError(400, "zcode_tools_unsupported", "ZCode sessions run with tools disabled; tool calls and tool results are not supported.");
    }
    const text = textOf(message.content).trim();
    if (text) lines.push(`[${labels[message.role] || "User"}]\n${text}`);
  }
  if (!lines.length) throw new ZcodeError(400, "zcode_empty_prompt", "No message text found in request.");
  return lines.join("\n\n");
}

/** Tool-disabled session creation command payload. */
export function buildCreateSessionPayload({ sessionId, workspaceId, cwd, model }) {
  return {
    sessionId,
    workspaceId,
    cwd,
    permissionScope: "session",
    mcpServers: [],
    offPeakToolEnabled: false,
    dynamicWorkflowEnabled: false,
    config: { model, toolDenylist: [...ZCODE_TOOL_DENYLIST], toolAllowlist: [] },
  };
}

/** Tracks the V4 conversation projection (snapshot + ordered deltas) for one session. */
export class ZcodeConversation {
  constructor() {
    this.rows = new Map();
    this.phase = null;
    this.lastError = null;
    this.usage = null;
    this.lastSeq = null;
    this.toolRow = null;
  }

  applyFrame(params) {
    const frame = isObject(params?.frame) ? params.frame : params;
    if (!isObject(frame) || !isObject(frame.payload)) return;
    // A duplicate or late delta frame is dropped; a gap is a protocol fault.
    if (frame.payload.kind === "deltas" && Number.isFinite(frame.fromSeq) && Number.isFinite(frame.toSeq)) {
      if (frame.toSeq <= (this.lastSeq ?? -1)) return;
      if (this.lastSeq != null && frame.fromSeq !== this.lastSeq) {
        throw new ZcodeError(502, "zcode_protocol_gap", "ZCode conversation frames arrived out of order.");
      }
      this.lastSeq = frame.toSeq;
    }
    if (frame.payload.kind === "snapshot") {
      if (Number.isFinite(frame.toSeq)) this.lastSeq = frame.toSeq;
      this.#applySnapshot(frame.payload.snapshot);
    } else if (frame.payload.kind === "deltas" && Array.isArray(frame.payload.deltas)) {
      for (const delta of frame.payload.deltas) this.#applyDelta(delta);
    }
  }

  #applySnapshot(snapshot) {
    if (!isObject(snapshot)) return;
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : snapshot.rows?.window;
    this.rows.clear();
    for (const row of Array.isArray(rows) ? rows : []) this.#putRow(row);
    this.#applyState(snapshot);
  }

  #applyDelta(delta) {
    if (!isObject(delta)) return;
    if (delta.op === "row.appended" || delta.op === "row.upserted") this.#putRow(delta.row);
    else if (delta.op === "row.removed") {
      for (const id of [...this.rows.keys()]) if (id >= delta.fromRowId) this.rows.delete(id);
    } else if (delta.op === "row.delta") {
      const row = this.rows.get(delta.rowId);
      if (row && delta.path === "text" && isString(delta.append)) row.text = `${row.text || ""}${delta.append}`;
    } else if (delta.op === "state.updated") this.#applyState(delta.patch);
  }

  #putRow(row) {
    if (!isObject(row) || !Number.isFinite(row.rowId)) return;
    this.rows.set(row.rowId, { ...row });
    if (TOOL_ROW_KINDS.has(row.kind) && !this.toolRow) this.toolRow = row;
  }

  #applyState(state) {
    if (!isObject(state)) return;
    const control = isObject(state.control) ? state.control : state;
    if (isString(control.phase)) this.phase = control.phase;
    if ("lastError" in control && isObject(control.lastError)) this.lastError = control.lastError;
    if (isObject(state.usage)) this.usage = state.usage;
  }

  /** Assistant text in row order, only rows after the user's own input row. */
  assistantText() {
    return [...this.rows.values()]
      .filter((row) => row.kind === "assistantText")
      .sort((a, b) => a.rowId - b.rowId)
      .map((row) => row.text || "")
      .join("");
  }

  get terminal() {
    return TERMINAL_PHASES.has(this.phase);
  }
}

/** Newline-framed JSON-RPC style client over a child-process-like transport. */
export class ZcodeV4Client {
  constructor(proc, { requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
    this.proc = proc;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.failure = null;
    this.buffer = "";
    this.decoder = new StringDecoder("utf8");
    proc.stdout?.on("data", (chunk) => this.#feed(chunk));
    proc.stderr?.on("data", () => {});
    proc.on("error", (error) => this.#fail(error?.code === "ENOENT"
      ? new ZcodeError(503, "zcode_unavailable", "ZCode CLI was not found. Install ZCode or set DURINDOOR_ZCODE_BIN.")
      : new ZcodeError(502, "zcode_process_error", `ZCode process error: ${clean(error?.message)}`)));
    proc.on("exit", (code, signal) => this.#fail(new ZcodeError(502, "zcode_process_exited",
      `ZCode process exited before the turn finished (${signal || `code ${code ?? "unknown"}`}).`)));
  }

  onNotification(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #fail(error) {
    if (this.failure) return;
    this.failure = error;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
    for (const listener of this.listeners) listener(null, error);
  }

  #feed(chunk) {
    this.buffer += isString(chunk) ? chunk : this.decoder.write(chunk);
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.#dispatch(line);
    }
  }

  #dispatch(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!isObject(message)) return;
    if (message.id != null && message.method) {
      // The runtime asked us something (approval, elicitation). Never grant it.
      this.#write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Not supported by this client" } });
      for (const listener of this.listeners) listener({ method: message.method, params: message.params, serverRequest: true });
      return;
    }
    if (message.id != null) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        entry.reject(new ZcodeError(502, "zcode_rpc_error", `ZCode rejected ${entry.method}: ${clean(message.error.message)}`));
      } else entry.resolve(message.result);
      return;
    }
    if (message.method) for (const listener of this.listeners) listener({ method: message.method, params: message.params });
  }

  #write(message) {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ZcodeError(504, "zcode_timeout", `ZCode did not answer ${method} in time.`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.#write({ jsonrpc: "2.0", id, method, params }); } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new ZcodeError(502, "zcode_process_error", `ZCode process error: ${clean(error?.message)}`));
      }
    });
  }

  /** Send a V4 command and require an accepted ACK. */
  async command(sessionId, type, payload) {
    const ack = await this.request(ZCODE_METHODS.command, {
      commandId: randomUUID(),
      clientId: "durindoor",
      sessionId,
      type,
      payload,
      issuedAt: Date.now(),
    });
    const status = isObject(ack) ? ack.status : null;
    if (status !== "accepted") {
      const detail = clean(isObject(ack) ? ack.message || ack.reasonCode : "no acknowledgement");
      throw new ZcodeError(status === "rejected" ? 400 : 502, "zcode_command_rejected", `ZCode ${status || "failed"} ${type}: ${detail}`);
    }
    return ack;
  }

  close() {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new ZcodeError(499, "zcode_closed", "ZCode session closed.")); }
    this.pending.clear();
    this.listeners.clear();
    try { this.proc.stdin?.end?.(); } catch { /* already closed */ }
    try { this.proc.kill?.(); } catch { /* already exited */ }
  }
}

export function buildZcodeEnv(source = process.env) {
  const env = {};
  for (const key of ENV_ALLOWLIST) if (isString(source[key])) env[key] = source[key];
  return env;
}

function resolveSpawnConfig(options) {
  const command = options.command || process.env.DURINDOOR_ZCODE_BIN?.trim() || "zcode";
  return { command, args: options.args || ["app-server"] };
}

export function defaultSpawnZcodeProcess({ command, args, cwd, env }) {
  return spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true });
}

/** Wait for the next conversation event with a deadline; events are queued so none are lost. */
function createEventQueue() {
  const queue = [];
  let wake = null;
  return {
    push(item) { queue.push(item); wake?.(); wake = null; },
    async next(signal, timeoutMs) {
      while (!queue.length) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { wake = null; reject(new ZcodeError(504, "zcode_turn_timeout", "ZCode turn timed out.")); }, timeoutMs);
          const abort = () => { clearTimeout(timer); wake = null; reject(signal.reason instanceof Error ? signal.reason : new DOMException("Request aborted", "AbortError")); };
          if (signal?.aborted) return abort();
          signal?.addEventListener("abort", abort, { once: true });
          wake = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(); };
        });
      }
      return queue.shift();
    },
  };
}

function mapSessionError(lastError) {
  const status = Number(lastError?.attribution?.statusCode);
  const message = clean(lastError?.message || lastError?.code || "ZCode session failed");
  if (status === 401 || status === 403) return new ZcodeError(401, "zcode_auth", `ZCode provider rejected the local profile credentials: ${message}`);
  if (status === 429) return new ZcodeError(429, "zcode_rate_limited", `ZCode provider rate limit: ${message}`);
  return new ZcodeError(502, "zcode_session_error", `ZCode session error: ${message}`);
}

export class ZcodeExecutor extends BaseExecutor {
  /**
   * @param {{ spawnProcess?: Function, command?: string, args?: string[], cwd?: string,
   *   requestTimeoutMs?: number, turnTimeoutMs?: number, maxConcurrent?: number }} options
   *   `spawnProcess` is the injected process/transport seam used by tests.
   */
  constructor(options = {}) {
    super("zcode", { id: "zcode", baseUrl: ZCODE_URL, noAuth: true });
    this.options = options;
    this.active = 0;
  }

  buildUrl() { return ZCODE_URL; }
  buildHeaders() { return {}; }
  transformRequest() { return null; }

  async #events({ model, prompt, signal, dispatch }) {
    const options = this.options;
    const spawnProcess = options.spawnProcess || defaultSpawnZcodeProcess;
    const ownsCwd = !options.cwd;
    const cwd = options.cwd || await mkdtemp(path.join(os.tmpdir(), "durindoor-zcode-"));
    const sessionId = randomUUID();
    let client = null;
    return { run: async function* run() {
      try {
        let proc;
        try {
          proc = spawnProcess({ ...resolveSpawnConfig(options), cwd, env: buildZcodeEnv() });
        } catch (error) {
          throw new ZcodeError(503, "zcode_unavailable", `ZCode process could not start: ${clean(error?.message)}`);
        }
        client = new ZcodeV4Client(proc, { requestTimeoutMs: options.requestTimeoutMs });
        const conversation = new ZcodeConversation();
        const queue = createEventQueue();
        client.onNotification((message, failure) => {
          if (failure) return queue.push({ failure });
          if (message.serverRequest) return queue.push({ failure: new ZcodeError(502, "zcode_interaction_refused", `ZCode asked for an interaction (${clean(message.method)}) that this gateway never grants.`) });
          if (message.method === ZCODE_METHODS.frame) {
            try { conversation.applyFrame(message.params); queue.push({ frame: true }); } catch (error) { queue.push({ failure: error }); }
          }
        });
        await abortable(client.command(null, "createSession", buildCreateSessionPayload({ sessionId, workspaceId: cwd, cwd, model })), signal);
        await abortable(client.request(ZCODE_METHODS.subscribe, { topic: `conversation/${sessionId}` }), signal);
        // sendText is the one billable send; session setup is not charged.
        await dispatch(() => client.command(sessionId, "sendText", { text: prompt, toolDisallowlist: [...ZCODE_TOOL_DENYLIST] }));

        let emitted = 0;
        const deadline = Date.now() + (options.turnTimeoutMs || DEFAULT_TURN_TIMEOUT_MS);
        for (;;) {
          if (conversation.toolRow) {
            await client.command(sessionId, "stop", {}).catch(() => {});
            throw new ZcodeError(502, "zcode_tool_call_rejected", `ZCode attempted a tool call (${clean(conversation.toolRow.toolName || conversation.toolRow.kind)}) in a text-only session; the turn was rejected.`);
          }
          const text = conversation.assistantText();
          if (text.length > emitted) { yield { text: text.slice(emitted) }; emitted = text.length; }
          if (conversation.terminal) break;
          const event = await queue.next(signal, Math.max(1, deadline - Date.now()));
          if (event.failure) throw event.failure;
        }
        if (conversation.phase === "error") throw mapSessionError(conversation.lastError);
        if (conversation.phase === "completedInterrupted") throw new ZcodeError(502, "zcode_turn_interrupted", "ZCode turn was interrupted before it finished.");
        return { usage: conversation.usage };
      } finally {
        if (client) {
          await client.request(ZCODE_METHODS.unsubscribe, { topic: `conversation/${sessionId}` }).catch(() => {});
          await client.command(sessionId, "deleteSession", {}).catch(() => {});
          client.close();
        }
        if (ownsCwd) await rm(cwd, { recursive: true, force: true }).catch(() => {});
      }
    } };
  }

  #fail(error, model) {
    const status = error instanceof ZcodeError ? error.status : 502;
    const code = error instanceof ZcodeError ? error.code : "zcode_error";
    const message = error instanceof ZcodeError ? error.message : `ZCode request failed: ${clean(error?.message)}`;
    return {
      response: new Response(JSON.stringify(buildErrorBody(status, message, { type: "provider_error", code })), { status, headers: { "Content-Type": "application/json" } }),
      url: ZCODE_URL,
      headers: {},
      transformedBody: { model },
    };
  }

  async execute(input) {
    const { model, body, stream, credentials, signal } = input;
    if (signal?.aborted) throw requestAbortError(signal.reason);
    if (!isZcodeDispatchEnabled(credentials)) {
      return this.#fail(new ZcodeError(403, "zcode_dispatch_disabled",
        `ZCode session dispatch is disabled for this connection. Set providerSpecificData.${ZCODE_OPT_IN_KEY} to true to opt in.`), model);
    }
    if (bindsConnectionRoute(input.proxyOptions)) {
      return this.#fail(new ZcodeError(400, "zcode_proxy_unsupported", "ZCode cannot use gateway proxy or relay settings."), model);
    }
    const max = this.options.maxConcurrent || DEFAULT_MAX_CONCURRENT;
    if (this.active >= max) return this.#fail(new ZcodeError(429, "zcode_busy", "Too many concurrent ZCode sessions."), model);
    this.active += 1;
    let resolvedModel = model;
    let started = null;
    const sender = createExecutorSender(this, input);
    let ack = null;
    const dispatch = async (send) => {
      ack = await sender.sendRequest(ZCODE_URL, { signal }, null, { transport: send });
    };
    // Every response returned after the send carries its quota ticket.
    const carry = (result) => {
      transferProviderAttemptDispatch(ack, result.response);
      return ack ? { ...result, attemptStartedAt: sender.attemptStartedAt } : result;
    };
    try {
      resolvedModel = resolveZcodeModel(model);
      const prompt = buildZcodePrompt(body);
      started = await this.#events({ model: resolvedModel, prompt, signal, dispatch });
      const generator = started.run();
      const release = () => { this.active -= 1; };
      const wantsStream = stream === true || body?.stream === true;
      const id = `chatcmpl-zcode-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);
      const chunk = (delta, finish = null, extra = {}) => ({ id, object: "chat.completion.chunk", created, model: resolvedModel, choices: [{ index: 0, delta, finish_reason: finish }], ...extra });

      if (!wantsStream) {
        let content = "";
        let result = null;
        try {
          for (;;) {
            const step = await generator.next();
            if (step.done) { result = step.value; break; }
            content += step.value.text;
          }
        } finally { release(); }
        const usage = result?.usage?.totalTokens != null || result?.usage?.promptTokens != null ? {
          prompt_tokens: result.usage.promptTokens ?? 0,
          completion_tokens: result.usage.completionTokens ?? 0,
          total_tokens: result.usage.totalTokens ?? (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0),
        } : undefined;
        const completion = { id, object: "chat.completion", created, model: resolvedModel, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
        if (usage) completion.usage = usage;
        return carry({
          response: new Response(JSON.stringify(completion), { status: 200, headers: { "Content-Type": "application/json" } }),
          url: ZCODE_URL, headers: {}, transformedBody: { model: resolvedModel },
        });
      }

      // Pull the first event before answering so setup failures keep a real HTTP status.
      let first;
      try { first = await generator.next(); } catch (error) { release(); throw error; }
      const encoder = new TextEncoder();
      const sse = (value) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
      let sentRole = false;
      let pendingFirst = first;
      let finished = false;
      const readable = new ReadableStream({
        async pull(controller) {
          if (finished) return;
          try {
            const step = pendingFirst || await generator.next();
            pendingFirst = null;
            if (!sentRole) { sentRole = true; controller.enqueue(sse(chunk({ role: "assistant" }))); }
            if (step.done) {
              finished = true;
              controller.enqueue(sse(chunk({}, "stop")));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              release();
              return;
            }
            controller.enqueue(sse(chunk({ content: step.value.text })));
          } catch (error) {
            finished = true;
            const failure = error instanceof ZcodeError ? error : new ZcodeError(502, "zcode_error", clean(error?.message));
            controller.enqueue(sse(buildErrorBody(failure.status, failure.message, { type: "provider_error", code: failure.code })));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            release();
          }
        },
        async cancel() {
          if (!finished) { finished = true; release(); }
          await generator.return(undefined).catch(() => {});
        },
      });
      return carry({
        response: new Response(readable, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } }),
        url: ZCODE_URL, headers: {}, transformedBody: { model: resolvedModel },
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        await settleProviderAttemptDispatch(ack, { reason: "abort" });
        throw error;
      }
      // Once the generator exists, the JSON/stream paths above own the slot release.
      if (!started) this.active -= 1;
      if (isQuotaDispatchUnavailable(error)) throw error;
      return carry(this.#fail(error, resolvedModel));
    }
  }
}

export default ZcodeExecutor;
