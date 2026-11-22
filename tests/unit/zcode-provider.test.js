// Staged ZCode local app-server provider. Every process here is an in-memory
// fake speaking the V4 stdio NDJSON contract pinned in
// internal/docs/zcode-v4-compatibility-1252.md: no ZCode install, profile,
// token or network is involved.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", async (original) => ({
  ...(await original()),
  createRequestLogger: vi.fn(async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() })),
}));

// Tests inject the fake process through an isolated executor while the registry is real.
const spawnHolder = vi.hoisted(() => ({ spawn: null }));
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { ZcodeExecutor } = await import("../../open-sse/executors/zcode.js");
  const executor = new ZcodeExecutor({ cwd: "/synthetic/workspace", requestTimeoutMs: 200, turnTimeoutMs: 2000, spawnProcess: (options) => spawnHolder.spawn(options) });
  return { ...original, getExecutor: (provider) => provider === "zcode" || provider === "zc" ? executor : original.getExecutor(provider) };
});

import entry, { zcodeCookieProfile } from "../../open-sse/providers/registry/zcode.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { ZCODE_TOOL_DENYLIST, ZcodeConversation, ZcodeError } from "../../open-sse/executors/zcode.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

const MODEL = "glm-5.3";
const topicOf = (sessionId) => `conversation/${sessionId}`;
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// ── fake V4 app-server ───────────────────────────────────────────────────────
const frameMessage = (sessionId, fromSeq, toSeq, payload) => ({
  jsonrpc: "2.0",
  method: "v4/conversation/frame",
  params: {
    wireVersion: 3, kind: "complete", deliveryKind: "online", logicalFrameId: `f${toSeq}`, logicalFrameOrdinal: toSeq,
    topic: topicOf(sessionId), subscriptionId: "sub-1",
    frame: { topic: topicOf(sessionId), subscriptionId: "sub-1", fromSeq, toSeq, sentAt: 0, payload },
  },
});
const snapshot = (phase = "running", rows = []) => ({ kind: "snapshot", snapshot: { rows: { window: rows }, control: { phase } } });
const deltas = (...list) => ({ kind: "deltas", deltas: list });
const textRow = (rowId, text, state = "streaming") => ({ rowId, kind: "assistantText", text, state });
const done = { op: "state.updated", patch: { control: { phase: "completedSuccess" } } };

/**
 * Starts a fake process. `turn(ctx)` runs after `sendText` is acknowledged and
 * pushes frames with ctx.frames(...payloads). `ack` overrides command ACKs.
 */
function createFake({ turn, ack = () => null, spawnError = null } = {}) {
  const processes = [];
  const spawn = (options) => {
    if (spawnError) throw spawnError;
    const proc = new EventEmitter();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.options = options;
    proc.requests = [];
    proc.killed = false;
    proc.kill = vi.fn(() => { proc.killed = true; });
    processes.push(proc);
    const write = (message) => { if (!proc.killed) proc.stdout.write(`${JSON.stringify(message)}\n`); };
    proc.write = write;
    const state = { seq: 0, sessionId: null };
    const ctx = {
      proc, state,
      frames(...payloads) {
        for (const payload of payloads) {
          const fromSeq = state.seq;
          state.seq += 1;
          write(frameMessage(state.sessionId, fromSeq, state.seq, payload));
        }
      },
    };
    let buffer = "";
    proc.stdin.on("data", (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const request = JSON.parse(line);
        proc.requests.push(request);
        handle(request);
      }
    });
    const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
    const handle = (request) => {
      const { id, method, params } = request;
      if (method === "v4/command") {
        const override = ack(params, ctx);
        if (override === "silent") return;
        reply(id, override || { commandId: params.commandId, status: "accepted", revisionAtDecision: 1 });
        if (override) return;
        if (params.type === "createSession") state.sessionId = params.payload.sessionId;
        if (params.type === "sendText") setImmediate(() => turn?.({ ...ctx, params }));
      } else if (method === "v4/conversation/subscribe") {
        reply(id, { subscriptionId: "sub-1", mode: "snapshot", logEpoch: "epoch-1" });
        setImmediate(() => ctx.frames(snapshot()));
      } else reply(id, {});
    };
    return proc;
  };
  return { spawn, processes };
}
const commandsOf = (proc, type) => proc.requests.filter((r) => r.method === "v4/command" && r.params.type === type);
const helloTurn = ({ frames }) => frames(
  deltas({ op: "row.appended", row: textRow(1, "Hel") }),
  deltas({ op: "row.delta", rowId: 1, path: "text", append: "lo" }),
  deltas({ op: "row.upserted", row: textRow(1, "Hello", "complete") }, done),
);

const ENABLED = { id: "connection-a", provider: "zcode", providerSpecificData: { enableSessionDispatch: true } };
// Direct executor call: keeps the provider's own error codes, which the gateway rewrites to generic ones.
const direct = (credentials, { stream = false, extra = {} } = {}) => getExecutor("zcode").execute({
  model: MODEL, stream, credentials,
  body: { model: MODEL, stream, messages: [{ role: "user", content: "hi there" }], ...extra },
});
const errorOf = async (result) => (await result.response.json()).error;
const call = (endpoint, credentials, { stream = false, extra = {}, anthropic = false } = {}) => {
  const body = anthropic
    ? { model: MODEL, max_tokens: 64, stream, messages: [{ role: "user", content: "hi there" }], ...extra }
    : { model: MODEL, stream, messages: [{ role: "user", content: "hi there" }], ...extra };
  return handleChatCore({
    body, modelInfo: { provider: "zcode", model: MODEL }, credentials, connectionId: credentials.id,
    clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: anthropic ? "claude" : undefined, log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
  });
};
const openai = (credentials, options) => call("/v1/chat/completions", credentials, options);
const messages = (credentials, options) => call("/v1/messages", credentials, { ...options, anthropic: true });

let fake;
beforeEach(() => { fake = createFake({ turn: helloTurn }); spawnHolder.spawn = fake.spawn; process.env.SYNTHETIC_ZCODE_SECRET = "must-not-leak"; });
afterEach(() => { vi.clearAllMocks(); delete process.env.SYNTHETIC_ZCODE_SECRET; });

describe("ZCode staged provider profile", () => {
  it("composes into the registry without a cookie profile and keeps opt-in vocabulary", () => {
    expect(entry).toMatchObject({ id: "zcode", alias: "zc", noAuth: true, transport: { executor: "zcode", format: "openai" } });
    expect(zcodeCookieProfile).toMatchObject({ notApplicable: true, domains: [], cookieNames: [], validationProbe: null });
    expect(REGISTRY.some((provider) => provider.id === "zcode")).toBe(true);
    expect(PROVIDERS.zcode.executor).toBe("zcode");
    expect(PROVIDER_MODELS.zc.map((model) => model.id)).toContain(MODEL);
    expect(getExecutor("zc")).toBe(getExecutor("zcode"));
  });
});

describe("ZCode dispatch guard", () => {
  it.each([
    ["missing providerSpecificData", {}],
    ["flag false", { providerSpecificData: { enableSessionDispatch: false } }],
    ["truthy string is not an opt-in", { providerSpecificData: { enableSessionDispatch: "true" } }],
  ])("refuses with a clear error and never starts a process: %s", async (_label, extra) => {
    for (const stream of [false, true]) {
      const credentials = { id: "off", provider: "zcode", ...extra };
      const routed = await openai(credentials, { stream });
      expect(routed.success).toBe(false);
      expect(routed.response.status).toBe(403);
      expect((await routed.response.json()).error.message).toContain("providerSpecificData.enableSessionDispatch");
      const own = await direct(credentials, { stream });
      expect(own.response.status).toBe(403);
      expect((await errorOf(own)).code).toBe("zcode_dispatch_disabled");
    }
    expect(fake.processes).toHaveLength(0);
  });
});

describe("ZCode text-only chat through the OpenAI and Anthropic routes", () => {
  it("returns OpenAI JSON and sends only tool-disabled, text-only session commands", async () => {
    const result = await openai(ENABLED, { extra: { messages: [{ role: "system", content: "be brief" }, { role: "user", content: [{ type: "text", text: "hi there" }] }] } });
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.choices[0].message).toEqual({ role: "assistant", content: "Hello" });
    expect(json.choices[0].finish_reason).toBe("stop");

    const [proc] = fake.processes;
    const [create] = commandsOf(proc, "createSession");
    expect(create.params.sessionId).toBeNull();
    expect(create.params.payload).toMatchObject({ mcpServers: [], permissionScope: "session", cwd: "/synthetic/workspace", config: { model: MODEL, toolDenylist: [...ZCODE_TOOL_DENYLIST] } });
    const [send] = commandsOf(proc, "sendText");
    expect(send.params.payload.text).toBe("[System]\nbe brief\n\n[User]\nhi there");
    expect(send.params.payload.toolDisallowlist).toEqual([...ZCODE_TOOL_DENYLIST]);
    expect(proc.requests.find((r) => r.method === "v4/conversation/subscribe").params.topic).toBe(topicOf(send.params.sessionId));
    // Ambient settings stay out: allowlisted env only, no connection-chosen command.
    expect(proc.options.env).not.toHaveProperty("SYNTHETIC_ZCODE_SECRET");
    expect(proc.options.args).toEqual(["app-server"]);
    expect(proc.kill).toHaveBeenCalled();
    expect(commandsOf(proc, "deleteSession")).toHaveLength(1);
  });

  it("streams OpenAI chunks as the projection grows", async () => {
    const result = await openai(ENABLED, { stream: true });
    expect(result.success).toBe(true);
    const text = await result.response.text();
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    const contents = [...text.matchAll(/"content":"([^"]*)"/g)].map((m) => m[1]);
    expect(contents.join("")).toBe("Hello");
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
    expect(fake.processes[0].kill).toHaveBeenCalled();
  });

  it("serves a Messages request as an Anthropic message", async () => {
    const result = await messages(ENABLED);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.content[0]).toMatchObject({ type: "text", text: "Hello" });
  });

  it("serves a streamed Messages request as Anthropic events", async () => {
    const result = await messages(ENABLED, { stream: true });
    expect(result.success).toBe(true);
    const text = await result.response.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("content_block_delta");
    expect(text).toContain("Hel");
    expect(text).toContain("event: message_stop");
  });

  it("cancels the session when the client abandons a stream", async () => {
    fake = createFake({ turn: ({ frames }) => frames(deltas({ op: "row.appended", row: textRow(1, "partial") })) });
    spawnHolder.spawn = fake.spawn;
    const result = await openai(ENABLED, { stream: true });
    const reader = result.response.body.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(fake.processes[0].kill).toHaveBeenCalled());
    expect(commandsOf(fake.processes[0], "deleteSession")).toHaveLength(1);
  });
});

describe("ZCode tool restrictions", () => {
  it.each([
    ["request tools", { tools: [{ type: "function", function: { name: "run", parameters: {} } }] }],
    ["tool result history", { messages: [{ role: "user", content: "x" }, { role: "tool", tool_call_id: "c1", content: "out" }] }],
    ["assistant tool calls", { messages: [{ role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "run", arguments: "{}" } }] }, { role: "user", content: "x" }] }],
    ["image content", { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }] }],
  ])("rejects %s before any process starts", async (_label, extra) => {
    const result = await direct(ENABLED, { extra });
    expect(result.response.status).toBe(400);
    expect(["zcode_tools_unsupported", "zcode_text_only"]).toContain((await errorOf(result)).code);
    expect(fake.processes).toHaveLength(0);
  });

  it("rejects request tools on the OpenAI route as well", async () => {
    const result = await openai(ENABLED, { extra: { tools: [{ type: "function", function: { name: "run", parameters: {} } }] } });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(400);
    expect(fake.processes).toHaveLength(0);
  });

  it("rejects a runtime tool-call attempt and stops the session (JSON)", async () => {
    fake = createFake({ turn: ({ frames }) => frames(deltas({ op: "row.appended", row: { rowId: 2, kind: "toolCall", toolCallId: "t1", toolName: "Bash", status: "running", inputText: "ls" } })) });
    spawnHolder.spawn = fake.spawn;
    const result = await direct(ENABLED);
    expect(result.response.status).toBe(502);
    expect((await errorOf(result)).code).toBe("zcode_tool_call_rejected");
    expect(commandsOf(fake.processes[0], "stop")).toHaveLength(1);
    expect(fake.processes[0].kill).toHaveBeenCalled();
  });

  it("keeps the HTTP status for a streamed tool-call attempt and never leaks the tool input", async () => {
    fake = createFake({ turn: ({ frames }) => frames(deltas({ op: "row.appended", row: { rowId: 2, kind: "toolCall", toolCallId: "t1", toolName: "Bash", status: "running", inputText: "cat ~/secret" } })) });
    spawnHolder.spawn = fake.spawn;
    const result = await openai(ENABLED, { stream: true });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(await result.response.text()).not.toContain("cat ~/secret");
  });

  it("refuses runtime interaction requests instead of approving them", async () => {
    fake = createFake({ turn: ({ proc }) => proc.write({ jsonrpc: "2.0", id: 99, method: "v4/interaction/request", params: { kind: "permission" } }) });
    spawnHolder.spawn = fake.spawn;
    const result = await direct(ENABLED);
    expect(result.response.status).toBe(502);
    expect((await errorOf(result)).code).toBe("zcode_interaction_refused");
  });
});

describe("ZCode process error mapping", () => {
  it("maps a missing executable to 503 and a failed spawn to 503", async () => {
    const missing = Object.assign(new Error("spawn zcode ENOENT"), { code: "ENOENT" });
    fake = createFake({ spawnError: missing });
    spawnHolder.spawn = fake.spawn;
    const result = await direct(ENABLED);
    expect(result.response.status).toBe(503);
    expect((await errorOf(result)).code).toBe("zcode_unavailable");
  });

  it("maps an asynchronous spawn error event to 503", async () => {
    fake = createFake({ ack: (params, { proc }) => { if (params.type === "createSession") { setImmediate(() => proc.emit("error", Object.assign(new Error("spawn zcode ENOENT"), { code: "ENOENT" }))); return "silent"; } return null; } });
    spawnHolder.spawn = fake.spawn;
    const result = await direct(ENABLED);
    expect(result.response.status).toBe(503);
  });

  it("maps an exit before completion to 502", async () => {
    fake = createFake({ turn: ({ proc }) => { proc.killed = false; proc.emit("exit", 1, null); } });
    spawnHolder.spawn = fake.spawn;
    const result = await direct(ENABLED);
    expect(result.response.status).toBe(502);
    expect((await errorOf(result)).code).toBe("zcode_process_exited");
  });

  it.each([
    [429, 429, "zcode_rate_limited"],
    [401, 401, "zcode_auth"],
    [403, 401, "zcode_auth"],
    [500, 502, "zcode_session_error"],
  ])("maps a session error with provider status %i to HTTP %i", async (statusCode, expected, code) => {
    fake = createFake({ turn: ({ frames }) => frames(deltas({ op: "state.updated", patch: { control: { phase: "error", lastError: { code: "fault.provider", message: "upstream said no", recoverable: false, source: "provider", attribution: { statusCode } } } } })) });
    spawnHolder.spawn = fake.spawn;
    const result = await direct(ENABLED);
    expect(result.response.status).toBe(expected);
    expect((await errorOf(result)).code).toBe(code);
  });

  it("maps a rejected command ACK to 400 and a failed ACK to 502", async () => {
    for (const [status, expected] of [["rejected", 400], ["failed", 502]]) {
      fake = createFake({ ack: (params) => (params.type === "sendText" ? { commandId: params.commandId, status, reasonCode: "guard.test", revisionAtDecision: 1 } : null) });
      spawnHolder.spawn = fake.spawn;
      const result = await direct(ENABLED);
      expect(result.response.status).toBe(expected);
      expect((await errorOf(result)).code).toBe("zcode_command_rejected");
    }
  });

  it("maps an interrupted turn to 502", async () => {
    fake = createFake({ turn: ({ frames }) => frames(deltas({ op: "state.updated", patch: { control: { phase: "completedInterrupted" } } })) });
    spawnHolder.spawn = fake.spawn;
    const result = await direct(ENABLED);
    expect(result.response.status).toBe(502);
    expect((await errorOf(result)).code).toBe("zcode_turn_interrupted");
  });

  it("maps a silent runtime to 504 and still tears the process down", async () => {
    fake = createFake({ ack: () => "silent" });
    spawnHolder.spawn = fake.spawn;
    const result = await direct(ENABLED);
    expect(result.response.status).toBe(504);
    expect(fake.processes[0].kill).toHaveBeenCalled();
  });

  it("delivers an in-band error chunk when a stream fails after output started", async () => {
    fake = createFake({ turn: ({ frames }) => frames(deltas({ op: "row.appended", row: textRow(1, "part") }), deltas({ op: "state.updated", patch: { control: { phase: "error", lastError: { code: "fault.x", message: "boom", recoverable: false, source: "runtime" } } } })) });
    spawnHolder.spawn = fake.spawn;
    const result = await openai(ENABLED, { stream: true });
    expect(result.success).toBe(true);
    const text = await result.response.text();
    expect(text).toContain("part");
    expect(text).toContain("zcode_session_error");
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("reports a gap in the conversation sequence as a protocol fault", () => {
    const conversation = new ZcodeConversation();
    conversation.applyFrame({ frame: { fromSeq: 0, toSeq: 1, payload: snapshot() } });
    conversation.applyFrame({ frame: { fromSeq: 1, toSeq: 2, payload: deltas({ op: "row.appended", row: textRow(1, "a") }) } });
    // A repeated or late frame is dropped silently.
    conversation.applyFrame({ frame: { fromSeq: 1, toSeq: 2, payload: deltas({ op: "row.appended", row: textRow(1, "dup") }) } });
    expect(conversation.assistantText()).toBe("a");
    expect(() => conversation.applyFrame({ frame: { fromSeq: 5, toSeq: 6, payload: deltas(done) } })).toThrow(ZcodeError);
  });
});

describe("ZCode connection isolation", () => {
  it("never lets one connection's opt-in cover another", async () => {
    const other = { id: "connection-b", provider: "zcode", providerSpecificData: {} };
    const allowed = await openai(ENABLED);
    const refused = await openai(other);
    expect(allowed.success).toBe(true);
    expect(refused.response.status).toBe(403);
    expect(fake.processes).toHaveLength(1);
  });

  it("runs concurrent connections in separate processes and sessions without crosstalk", async () => {
    // Each fake process answers with the prompt it received, so mixing would show.
    fake = createFake({ turn: ({ frames, params }) => frames(deltas({ op: "row.appended", row: textRow(1, `echo:${params.payload.text.replace(/^\[User\]\n/, "")}`, "complete") }, done)) });
    spawnHolder.spawn = fake.spawn;
    const second = { ...ENABLED, id: "connection-c" };
    const request = (credentials, content) => openai(credentials, { extra: { messages: [{ role: "user", content }] } });
    const [a, b] = await Promise.all([request(ENABLED, "alpha"), request(second, "beta")]);
    expect((await a.response.json()).choices[0].message.content).toBe("echo:alpha");
    expect((await b.response.json()).choices[0].message.content).toBe("echo:beta");
    expect(fake.processes).toHaveLength(2);
    const sessions = fake.processes.map((proc) => commandsOf(proc, "sendText")[0].params.sessionId);
    expect(new Set(sessions).size).toBe(2);
    expect(fake.processes.every((proc) => proc.kill.mock.calls.length > 0)).toBe(true);
  });

  it("bounds concurrent sessions", async () => {
    const executor = getExecutor("zcode");
    executor.options.maxConcurrent = 1;
    fake = createFake({ turn: () => {} });
    spawnHolder.spawn = fake.spawn;
    try {
      const controller = new AbortController();
      const first = executor.execute({ model: MODEL, body: { messages: [{ role: "user", content: "x" }] }, stream: false, credentials: ENABLED, signal: controller.signal });
      await vi.waitFor(() => expect(fake.processes).toHaveLength(1));
      const second = await executor.execute({ model: MODEL, body: { messages: [{ role: "user", content: "y" }] }, stream: false, credentials: ENABLED });
      expect(second.response.status).toBe(429);
      controller.abort();
      await expect(first).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      delete executor.options.maxConcurrent;
    }
    expect(executor.active).toBe(0);
  });
});
