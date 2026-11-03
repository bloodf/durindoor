import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexAppServerExecutor, buildDynamicTools, buildPromptText } from "../../open-sse/executors/codex-app-server.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const TOKEN = "cap-token-0123456789abcdef";
const ENV_KEYS = [
  "DURINDOOR_CODEX_APPSERVER_WS", "DURINDOOR_CODEX_APPSERVER_WS_TOKEN", "DURINDOOR_CODEX_APPSERVER_WS_TOKEN_FILE",
  "DURINDOOR_CODEX_APPSERVER_CWD", "DURINDOOR_CODEX_APPSERVER_AUTO_APPROVE", "DURINDOOR_CODEX_APPSERVER_ALLOW_INSECURE_WS",
  "DURINDOOR_CODEX_APPSERVER_APPROVAL", "DURINDOOR_CODEX_APPSERVER_SANDBOX", "DURINDOOR_CODEX_APPSERVER_TURN_TIMEOUT_MS",
];
let saved;

// Mocked transport: a scripted app-server on an in-memory socket.
function makeFactory(script) {
  const state = { url: null, options: null, sent: [] };
  const factory = (url, options) => {
    state.url = url;
    state.options = options;
    const socket = new EventEmitter();
    const push = (message) => socket.emit("message", Buffer.from(JSON.stringify(message)));
    socket.send = (data) => {
      const message = JSON.parse(data);
      state.sent.push(message);
      script(message, { push, socket });
    };
    socket.close = () => {};
    process.nextTick(() => socket.emit(script.failConnect ? "error" : "open", script.failConnect ? new Error(`connect ECONNREFUSED ${TOKEN}`) : undefined));
    return socket;
  };
  return { factory, state };
}

const basicScript = (turn) => (message, io) => {
  if (message.method === "initialize") io.push({ id: message.id, result: {} });
  else if (message.method === "thread/start") io.push({ id: message.id, result: { thread: { id: "thr_1" } } });
  else if (message.method === "turn/start") {
    io.push({ id: message.id, result: { turn: { status: "inProgress" } } });
    turn(io, message);
  }
};

async function run(script, body = {}, model = "gpt-5.4", extra = {}) {
  const { factory, state } = makeFactory(script);
  const executor = new CodexAppServerExecutor({ webSocketFactory: factory });
  const result = await executor.execute({ model, body: { messages: [{ role: "user", content: "hi" }], ...body }, ...extra });
  const text = await result.response.text();
  const chunks = text.split("\n").filter((l) => l.startsWith("data: ") && !l.includes("[DONE]")).map((l) => JSON.parse(l.slice(6)));
  return { result, text, chunks, state };
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.DURINDOOR_CODEX_APPSERVER_WS = "ws://127.0.0.1:1456";
  process.env.DURINDOOR_CODEX_APPSERVER_WS_TOKEN = TOKEN;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("codex-app-server registration", () => {
  it("registers a no-auth text-only provider with an executor and alias", () => {
    const entry = REGISTRY.find((p) => p.id === "codex-app-server");
    expect(entry).toMatchObject({ alias: "cxa", noAuth: true });
    expect(entry.models.length).toBeGreaterThan(0);
    expect(entry.models.every((m) => !m.kind)).toBe(true);
    expect(entry.display.name).toMatch(/unverified/i);
    expect(entry.display.notice.text).toMatch(/experimental and unsupported/);
    expect(hasSpecializedExecutor("codex-app-server")).toBe(true);
    expect(getExecutor("cxa")).toBeInstanceOf(CodexAppServerExecutor);
  });
});

describe("codex-app-server config", () => {
  it("returns 503 without calling the transport when unconfigured", async () => {
    delete process.env.DURINDOOR_CODEX_APPSERVER_WS_TOKEN;
    const { factory, state } = makeFactory(basicScript(() => {}));
    const out = await new CodexAppServerExecutor({ webSocketFactory: factory }).execute({ model: "gpt-5.4", body: {} });
    expect(out.response.status).toBe(503);
    expect((await out.response.json()).error.code).toBe("codex_app_server_unconfigured");
    expect(state.url).toBeNull();
  });

  it("rejects non-websocket URLs and URLs that embed credentials", async () => {
    for (const url of ["http://localhost:1456", "ws://user:pw@localhost:1456"]) {
      process.env.DURINDOOR_CODEX_APPSERVER_WS = url;
      const { factory, state } = makeFactory(basicScript(() => {}));
      const out = await new CodexAppServerExecutor({ webSocketFactory: factory }).execute({ model: "gpt-5.4", body: {} });
      expect(out.response.status).toBe(503);
      expect(state.url).toBeNull();
    }
  });
});

const guard = () => {
  const uncaught = [];
  const onError = (error) => uncaught.push(error);
  process.on("uncaughtException", onError);
  process.on("unhandledRejection", onError);
  return { uncaught, stop: () => { process.off("uncaughtException", onError); process.off("unhandledRejection", onError); } };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const turnDone = (io) => io.push({ method: "turn/completed", params: {} });

describe("codex-app-server safe defaults and opt-in", () => {
  it("defaults to a read-only sandbox with on-request approvals, and honours explicit overrides", async () => {
    const defaults = await run(basicScript(turnDone));
    expect(defaults.state.sent[1].params).toMatchObject({ approvalPolicy: "on-request", sandbox: "read-only" });
    process.env.DURINDOOR_CODEX_APPSERVER_APPROVAL = "never";
    process.env.DURINDOOR_CODEX_APPSERVER_SANDBOX = "workspace-write";
    const opted = await run(basicScript(turnDone));
    expect(opted.state.sent[1].params).toMatchObject({ approvalPolicy: "never", sandbox: "workspace-write" });
  });

  it("refuses cleartext ws:// to a non-loopback host unless opted in", async () => {
    process.env.DURINDOOR_CODEX_APPSERVER_WS = "ws://app-server.internal:1456";
    const { factory, state } = makeFactory(basicScript(() => {}));
    const out = await new CodexAppServerExecutor({ webSocketFactory: factory }).execute({ model: "gpt-5.4", body: {} });
    expect(out.response.status).toBe(503);
    expect(state.url).toBeNull();
    process.env.DURINDOOR_CODEX_APPSERVER_ALLOW_INSECURE_WS = "true";
    const allowed = await run(basicScript(turnDone));
    expect(allowed.state.url).toBe("ws://app-server.internal:1456");
  });

  it("allows wss:// to any host", async () => {
    process.env.DURINDOOR_CODEX_APPSERVER_WS = "wss://app-server.example:443";
    const { state } = await run(basicScript(turnDone));
    expect(state.url).toBe("wss://app-server.example:443");
  });
});

describe("codex-app-server lifecycle", () => {
  it("survives a body cancel followed by an abort", async () => {
    const g = guard();
    const { factory } = makeFactory(basicScript(() => {}));
    const controller = new AbortController();
    const out = await new CodexAppServerExecutor({ webSocketFactory: factory }).execute({
      model: "gpt-5.4", body: { messages: [{ role: "user", content: "hi" }] }, signal: controller.signal,
    });
    await out.response.body.cancel();
    controller.abort();
    await settle();
    g.stop();
    expect(g.uncaught).toEqual([]);
  });

  it("survives a cancel during connect", async () => {
    const g = guard();
    const { factory } = makeFactory(basicScript(() => {}));
    const out = await new CodexAppServerExecutor({ webSocketFactory: factory }).execute({
      model: "gpt-5.4", body: { messages: [{ role: "user", content: "hi" }] },
    });
    await out.response.body.cancel();
    await settle();
    g.stop();
    expect(g.uncaught).toEqual([]);
  });

  it("interrupts with the real turn id on abort and never sends an empty id", async () => {
    const controller = new AbortController();
    const { factory, state } = makeFactory((message, io) => {
      if (message.method === "initialize") io.push({ id: message.id, result: {} });
      else if (message.method === "thread/start") io.push({ id: message.id, result: { thread: { id: "thr_1" } } });
      else if (message.method === "turn/start") {
        io.push({ id: message.id, result: { turn: { id: "turn_7", status: "inProgress" } } });
        setTimeout(() => controller.abort(), 5);
      }
    });
    const out = await new CodexAppServerExecutor({ webSocketFactory: factory }).execute({
      model: "gpt-5.4", body: { messages: [{ role: "user", content: "hi" }] }, signal: controller.signal,
    });
    const text = await out.response.text();
    expect(state.sent.filter((m) => m.method === "turn/interrupt")).toEqual([
      { jsonrpc: "2.0", method: "turn/interrupt", params: { threadId: "thr_1", turnId: "turn_7" } },
    ]);
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("handles an abort that arrives before thread/start", async () => {
    const controller = new AbortController();
    controller.abort();
    const { factory, state } = makeFactory(basicScript(() => {}));
    const out = await new CodexAppServerExecutor({ webSocketFactory: factory }).execute({
      model: "gpt-5.4", body: { messages: [{ role: "user", content: "hi" }] }, signal: controller.signal,
    });
    const text = await out.response.text();
    const methods = state.sent.map((m) => m.method);
    expect(methods).not.toContain("thread/start");
    expect(methods).not.toContain("turn/interrupt");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("fails an unfinished turn after the overall timeout", async () => {
    const { factory } = makeFactory(basicScript(() => {}));
    const out = await new CodexAppServerExecutor({ webSocketFactory: factory, turnTimeoutMs: 30 }).execute({
      model: "gpt-5.4", body: { messages: [{ role: "user", content: "hi" }] },
    });
    const text = await out.response.text();
    expect(text).toMatch(/timed out after 30ms/);
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });
});

describe("codex-app-server turn", () => {
  it("streams a text turn as chat chunks with bearer handshake and hardened defaults", async () => {
    const { chunks, text, state } = await run(basicScript((io) => {
      io.push({ method: "item/reasoning/textDelta", params: { delta: "think" } });
      io.push({ method: "item/agentMessage/delta", params: { delta: "Hel" } });
      io.push({ method: "item/agentMessage/delta", params: { delta: "lo" } });
      io.push({ method: "turn/completed", params: { turn: { usage: { input_tokens: 3, output_tokens: 2 } } } });
    }), { reasoning_effort: "low" }, "gpt-5.4-high");
    expect(state.url).toBe("ws://127.0.0.1:1456");
    expect(state.options.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    const methods = state.sent.map((m) => m.method);
    expect(methods).toEqual(["initialize", "thread/start", "turn/start"]);
    expect(state.sent[1].params).toMatchObject({ approvalPolicy: "on-request", sandbox: "read-only", cwd: "/tmp" });
    expect(state.sent[1].params.dynamicTools).toBeUndefined();
    expect(state.sent[2].params).toMatchObject({ threadId: "thr_1", model: "gpt-5.4", effort: "high" });
    expect(state.sent[2].params.input[0].text).toContain("[User]\nhi");
    expect(chunks.map((c) => c.choices[0].delta.content).filter(Boolean).join("")).toBe("Hello");
    expect(chunks.find((c) => c.choices[0].delta.reasoning_content).choices[0].delta.reasoning_content).toBe("think");
    const last = chunks.at(-1);
    expect(last.choices[0].finish_reason).toBe("stop");
    expect(last.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
    expect(text).not.toContain(TOKEN);
  });

  it("advertises harness tools and surfaces item/tool/call as tool_calls", async () => {
    let answered;
    const { chunks, state } = await run(basicScript((io) => {
      io.push({ id: 900, method: "item/tool/call", params: { callId: "call_1", namespace: "mcp", tool: "read", arguments: { path: "a" } } });
    }), { tools: [{ type: "function", function: { name: "read", description: "d", parameters: { type: "object", properties: { path: { type: "string" } } } } }] });
    answered = state.sent.find((m) => m.id === 900);
    expect(state.sent[0].params.capabilities).toEqual({ experimentalApi: true, requestAttestation: false });
    expect(state.sent[1].params.dynamicTools).toEqual([
      { type: "function", name: "read", description: "d", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
    ]);
    expect(answered.result.success).toBe(false);
    const call = chunks.find((c) => c.choices[0].delta.tool_calls).choices[0].delta.tool_calls[0];
    expect(call).toMatchObject({ index: 0, id: "call_1", type: "function", function: { name: "mcp__read", arguments: '{"path":"a"}' } });
    expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("answers approval prompts with schema-defined values: fail closed by default, accept only on opt-in", async () => {
    const approval = (io) => {
      io.push({ id: 700, method: "item/commandExecution/requestApproval", params: {} });
      io.push({ id: 702, method: "item/fileChange/requestApproval", params: {} });
      io.push({ id: 703, method: "item/permissions/requestApproval", params: { permissions: { network: { enabled: true } } } });
      io.push({ id: 704, method: "execCommandApproval", params: {} });
      io.push({ id: 701, method: "item/unknown/request", params: {} });
      io.push({ method: "turn/completed", params: {} });
    };
    const result = (run_, id) => run_.state.sent.find((m) => m.id === id).result;
    const denied = await run(basicScript(approval));
    expect(result(denied, 700)).toEqual({ decision: "decline" });
    expect(result(denied, 702)).toEqual({ decision: "decline" });
    expect(result(denied, 703)).toEqual({ permissions: {}, scope: "turn" });
    expect(result(denied, 704)).toEqual({ decision: "abort" });
    expect(denied.state.sent.find((m) => m.id === 701).error.code).toBe(-32601);
    process.env.DURINDOOR_CODEX_APPSERVER_AUTO_APPROVE = "true";
    const approved = await run(basicScript(approval));
    expect(result(approved, 700)).toEqual({ decision: "accept" });
    expect(result(approved, 702)).toEqual({ decision: "accept" });
    expect(result(approved, 703)).toEqual({ permissions: {}, scope: "turn" });
    expect(result(approved, 704)).toEqual({ decision: "approved" });
  });

  it("interrupts with the late turn id when the abort lands while turn/start is in flight", async () => {
    const controller = new AbortController();
    const { factory, state } = makeFactory((message, io) => {
      if (message.method === "initialize") io.push({ id: message.id, result: {} });
      else if (message.method === "thread/start") io.push({ id: message.id, result: { thread: { id: "thr_1" } } });
      else if (message.method === "turn/start") {
        setTimeout(() => controller.abort(), 5);
        setTimeout(() => io.push({ id: message.id, result: { turn: { id: "turn_late" } } }), 30);
      }
    });
    const out = await new CodexAppServerExecutor({ webSocketFactory: factory }).execute({
      model: "gpt-5.4", body: { messages: [{ role: "user", content: "hi" }] }, signal: controller.signal,
    });
    const text = await out.response.text();
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(state.sent.filter((m) => m.method === "turn/interrupt")).toEqual([
      { jsonrpc: "2.0", method: "turn/interrupt", params: { threadId: "thr_1", turnId: "turn_late" } },
    ]);
  });

  it("reports an app-server error notification in-band", async () => {
    const { chunks, text } = await run(basicScript((io) => io.push({ method: "error", params: { error: { message: "rate limited" } } })));
    expect(chunks.at(-1).error).toMatchObject({ message: "rate limited", code: "codex_app_server_turn_failed" });
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("reports connection failure in-band without leaking the capability token", async () => {
    const script = basicScript(() => {});
    script.failConnect = true;
    const { chunks, text } = await run(script);
    expect(chunks.at(-1).error.type).toBe("provider_error");
    expect(text).not.toContain(TOKEN);
  });
});

describe("codex-app-server request mapping", () => {
  it("flattens history and tool results into a text prompt", () => {
    expect(buildPromptText([
      { role: "system", content: "Be terse." },
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", content: "ok" },
    ])).toBe("[System]\nBe terse.\n\n[User]\ngo\n\n[Assistant]\n[Tool call c1] f({})\n\n[Tool result]\nok");
  });

  it("ignores non-function tools", () => {
    expect(buildDynamicTools([{ type: "web_search" }, null])).toEqual([]);
  });
});
