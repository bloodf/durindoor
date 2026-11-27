// UC (uncensored.com) native persona WebSocket chat, staged and unregistered
// (#1241, #2034). Closed mocks only: Clerk mints go through a synthetic
// transport that fails the test on an unexpected request, the persona socket
// is a synthetic WebSocket class driven by per-test scripts, and every cookie,
// uid and JWT is synthetic. Wire shapes follow OmniRoute c71f0065
// (executors/uc.ts, uc/catalog.ts, uc/protocol.ts, uc/stream.ts,
// uc/toolDialect.ts, uc/ws.ts, uc/constants.ts). Passing here says nothing
// about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

import * as staged from "../../open-sse/services/providerParity/native-uc-chat/index.js";
import {
  UC_CHAT_MODELS,
  UC_CHAT_PROVIDER_DEFINITION,
  UC_CHAT_REGISTRY_MODELS,
  UcChatExecutor,
  UcFrameParser,
  assembleUcTurn,
  buildPersonaFrame,
  resolveUcChatModel,
  ucContextWindow,
} from "../../open-sse/services/providerParity/native-uc-chat/index.js";
import { createUcSessionController } from "../../open-sse/services/providerParity/native-uc-signin/index.js";
import { UC_PROVIDER_DEFINITION } from "../../open-sse/services/providerParity/native-uc-tts/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";

const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-uc-chat/registration.json", import.meta.url), "utf8"));

const CLERK = "https://clerk.uncensored.com";
const WS_HOST = "wss://internal-6.pubyar.com/ws";
const ENV = Object.freeze({ DURINDOOR_UC_CONSUMER_SIGNIN: "1" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
let clock = 1_800_000_000_000;
const now = () => clock;
const jwtAt = (account, lifetimeS = 60, tag = "") =>
  `${b64url({ alg: "RS256" })}.${b64url({ uid: account.uid, sid: account.sid, exp: Math.floor(clock / 1000) + lifetimeS })}.SYNTHETICsig${account.tag}${tag}`;

const A = { tag: "a", uid: "0a1b2c3d-0000-4000-8000-00000000000a", sid: "sess_SYNTHa", client: "SYNTHETIC-client-aaaa", cf: "SYNTHETIC-cf-aaaa" };
const B = { tag: "b", uid: "0a1b2c3d-0000-4000-8000-00000000000b", sid: "sess_SYNTHb", client: "SYNTHETIC-client-bbbb", cf: "SYNTHETIC-cf-bbbb" };
const credsFor = (account, extra = {}) => ({
  connectionId: `conn-${account.tag}`,
  providerSpecificData: {
    ucClientCookie: account.client,
    ucSid: account.sid,
    ucUid: account.uid,
    ucCookies: { __client: account.client, __cf_bm: account.cf },
    ucAuthSource: "email-code",
    ucSignedInAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  },
});

const reply = (status, body, cookies = []) =>
  new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: new Headers([["content-type", "application/json"], ...cookies.map((c) => ["set-cookie", c])]),
  });

let clerkCalls;
let mints;
/** Synthetic Clerk transport: only the token mint of a known account is answered. */
const fetchImpl = vi.fn(async (url, init) => {
  const parsed = new URL(url);
  clerkCalls.push({ url, path: parsed.pathname, init });
  const sid = parsed.pathname.match(/^\/v1\/client\/sessions\/([^/]+)\/tokens$/)?.[1];
  const handler = sid && mints[sid];
  if (!handler || init.method !== "POST") throw new Error(`unexpected request ${init.method} ${parsed.pathname}`);
  return handler(init);
});
const mintOk = (account, lifetimeS = 60, tag = "") => () => reply(200, { object: "token", jwt: jwtAt(account, lifetimeS, tag) });

let sockets;
let scripts;
class FakeSocket {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.sent = [];
    this.listeners = {};
    this.closed = false;
    this.terminated = false;
    sockets.push(this);
    const script = scripts.shift();
    this.unexpected = !script;
    queueMicrotask(() => script?.(this));
  }
  on(event, handler) {
    this.listeners[event] = handler;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  terminate() {
    this.terminated = true;
  }
  open() {
    this.onopen?.();
  }
  message(data) {
    this.onmessage?.({ data });
  }
  end(code = 1000) {
    this.onclose?.({ code });
  }
}

const f = (value) => JSON.stringify(value);
const textDelta = (text) => f({ message_type: "text", text });
const reasoning = (text) => f({ message_type: "intermediary_message", text });
const done = (raw_text) => f({ message_type: "text", end_of_stream: true, ...(raw_text === undefined ? {} : { raw_text }) });
const status = (s) => f({ message_type: "status", status: s });

/** Socket script: open, then each message in order (a string or a function of the socket). */
const answers = (...messages) => async (socket) => {
  socket.open();
  for (const m of messages) {
    await Promise.resolve();
    if (typeof m === "function") m(socket);
    else socket.message(m);
  }
};

const executor = (extra = {}) => new UcChatExecutor({
  sessionController: createUcSessionController({ fetchImpl, env: ENV, now, refreshSkewMs: 8_000 }),
  env: ENV,
  WebSocketImpl: FakeSocket,
  ...extra,
});

const userBody = (content = "hello", extra = {}) => ({ messages: [{ role: "user", content }], ...extra });
const run = (ex, { model = "claude-opus-47", body = userBody(), stream = false, credentials = credsFor(A), ...rest } = {}) =>
  ex.execute({ model, body, stream, credentials, ...rest });

async function sseEvents(response) {
  const text = await response.text();
  const blocks = text.split("\n\n").filter(Boolean);
  expect(blocks.at(-1)).toBe("data: [DONE]");
  return blocks.slice(0, -1).map((b) => JSON.parse(b.replace(/^data: /, "")));
}
const deltas = (events) => events.map((e) => e.choices[0].delta);
const finishes = (events) => events.map((e) => e.choices[0].finish_reason).filter(Boolean);

function translateStream(events, client) {
  const state = initState(client);
  const out = [];
  for (const chunk of events) out.push(...(translateResponse(FORMATS.OPENAI, client, chunk, state) || []));
  out.push(...(translateResponse(FORMATS.OPENAI, client, null, state) || []));
  return out.filter(Boolean);
}

const SECRETS = [A.client, A.cf, B.client, B.cf];
async function expectNoLeak(result, extra = []) {
  const text = `${await result.response.clone().text()} ${JSON.stringify({ url: result.url, headers: result.headers, body: result.transformedBody })}`;
  for (const secret of [...SECRETS, ...extra]) expect(text).not.toContain(secret);
  expect(text).not.toContain("token=");
}

beforeEach(() => {
  clerkCalls = [];
  sockets = [];
  scripts = [];
  mints = { [A.sid]: mintOk(A), [B.sid]: mintOk(B) };
  fetchImpl.mockClear();
});
afterEach(() => {
  clock = 1_800_000_000_000;
  vi.useRealTimers();
  expect(sockets.filter((s) => s.unexpected)).toEqual([]);
  expect(scripts).toEqual([]);
});

// Staging-only negatives. Registration replaces this block with positive
// registry identity checks; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("stays unregistered and leaves uc-direct unchanged", () => {
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(PROVIDERS.uc).toBeUndefined();
    expect(PROVIDERS.ucn).toBeUndefined();
    expect(hasSpecializedExecutor("uc")).toBe(false);
    expect(hasSpecializedExecutor("ucn")).toBe(false);
    expect(PROVIDERS["uc-direct"]).toBeDefined();
  });
});

describe("staged metadata and source constants", () => {
  it("pins the source commit and every listed export", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "uc", aliases: ["ucn"], baseUrl: "https://internal-6.pubyar.com", appVersion: "1.0.0-web" });
  });

  it("keeps the source wire constants", () => {
    expect(staged.UC_WS_HOST).toBe(WS_HOST);
    expect(staged.UC_CHAT_BASE_URL).toBe("https://internal-6.pubyar.com");
    expect(staged.UC_ORIGIN).toBe("https://uncensored.com");
    expect(staged.UC_APP_VERSION).toBe("1.0.0-web");
    expect(staged.UC_WS_TIMEOUT_MS).toBe(120_000);
    expect(staged.UC_TOKEN_REFRESH_SKEW_MS).toBe(8_000);
    expect(staged.UC_HISTORY_ROLES).toEqual({ user: "human", assistant: "assistant", tool: "human" });
    expect(staged.UC_PART_TYPE).toBe("text");
    expect(staged.UC_FRAME_TYPES).toEqual({
      error: "error", generationFailed: "generation_failed", status: "status", reasoning: "intermediary_message", text: "text", memoryStatus: "memory_status",
    });
    expect(staged.UC_TOP_LEVEL_ERROR_CODES).toEqual(["message_limit_exceeded", "paywall_exceeded", "rate_limit_exceeded", "unauthorized", "forbidden"]);
    expect(staged.UC_CODESTYLE_MODELS).toEqual(["gpt-5.5"]);
    expect(staged.UC_IDENTITY_STEER).toMatch(/^You are operating as a professional technical assistant\./);
  });

  it("shares identity and credential fields with the staged TTS definition and adds llm", () => {
    expect(UC_CHAT_PROVIDER_DEFINITION.id).toBe(UC_PROVIDER_DEFINITION.id);
    expect(UC_CHAT_PROVIDER_DEFINITION.alias).toBe(UC_PROVIDER_DEFINITION.alias);
    expect(UC_CHAT_PROVIDER_DEFINITION.credentialFields).toBe(UC_PROVIDER_DEFINITION.credentialFields);
    expect(UC_CHAT_PROVIDER_DEFINITION.serviceKinds).toEqual(["llm"]);
    expect(UC_CHAT_PROVIDER_DEFINITION.modelIds).toEqual(UC_CHAT_MODELS.map((m) => m.id));
  });
});

describe("source model catalog", () => {
  it("has exactly the 19 source persona ids in order", () => {
    expect(UC_CHAT_MODELS.map((m) => m.id)).toEqual([
      "claude-opus-45", "claude-opus-46", "claude-opus-46-v2", "claude-opus-47", "claude-opus-47-v2", "claude-opus-48-uncensored",
      "deepseek-r1", "glm-5.1", "gpt-5.5", "gemini-3-flash", "gemini-31-uncensored", "gemini-emotional", "gemini-3-uncensored",
      "grok-4", "grok-4-20", "grok-4-3", "kimi-k2-thinking", "kimi-k2.5", "minimax-m2-her",
    ]);
  });

  it("maps to the source registry model form", () => {
    expect(UC_CHAT_REGISTRY_MODELS.find((m) => m.id === "deepseek-r1")).toEqual({
      id: "deepseek-r1", name: "DeepSeek R1", contextLength: 163_840, toolCalling: true, maxOutputTokens: 16_000, supportsReasoning: true,
    });
    expect(UC_CHAT_REGISTRY_MODELS.find((m) => m.id === "grok-4-20")).toEqual({
      id: "grok-4-20", name: "Grok 4.20", contextLength: 2_000_000, toolCalling: true, supportsVision: true,
    });
    expect(UC_CHAT_REGISTRY_MODELS.every((m) => m.toolCalling === true)).toBe(true);
    expect(ucContextWindow("gpt-5.5")).toBe(1_050_000);
    expect(ucContextWindow("nope")).toBe(128_000);
  });

  it("routes bare, uc/ and ucn/ ids only to catalog models", () => {
    expect(resolveUcChatModel("kimi-k2.5")).toBe("kimi-k2.5");
    expect(resolveUcChatModel("uc/glm-5.1")).toBe("glm-5.1");
    expect(resolveUcChatModel("ucn/grok-4")).toBe("grok-4");
    expect(resolveUcChatModel("uc-direct/grok-4")).toBeNull();
    expect(resolveUcChatModel("gpt-5.4")).toBeNull();
    expect(resolveUcChatModel(undefined)).toBeNull();
  });

  it("refuses an unknown model before any network call", async () => {
    const result = await run(executor(), { model: "uc/gpt-5.4" });
    expect(result.response.status).toBe(400);
    expect((await result.response.json()).error.code).toBe("uc_unknown_model");
    expect(clerkCalls).toEqual([]);
    expect(sockets).toEqual([]);
  });
});

describe("turn assembly and persona frame", () => {
  it("splits at the last assistant and folds systems and the steer into text", () => {
    const { text, history } = assembleUcTurn([
      { role: "system", content: "Be brief." },
      { role: "user", content: [{ type: "text", text: "one" }, { type: "image_url", image_url: { url: "x" } }] },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    expect(history).toEqual([
      { role: "human", content: [{ type: "text", text: "one" }] },
      { role: "assistant", content: [{ type: "text", text: "two" }] },
    ]);
    expect(text).toBe(`Be brief.\n\n${staged.UC_IDENTITY_STEER}\n\n---\n\nthree`);
  });

  it("keeps tool calls in history and names a trailing tool result", () => {
    const { text, history } = assembleUcTurn([
      { role: "user", content: "weather?" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Paris\"}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "sunny" },
    ], { identitySteer: false });
    expect(history[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "<tool_call>{\"name\":\"get_weather\",\"arguments\":{\"city\":\"Paris\"}}</tool_call>" }] });
    expect(text).toBe("The get_weather tool already ran and returned:\nsunny\nUse this result to answer; do NOT call the tool again.");
  });

  it("maps a tool result inside history to a [tool result] human turn", () => {
    const { history } = assembleUcTurn([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "tool", tool_call_id: "x", content: "r" },
      { role: "assistant", content: "c" },
      { role: "user", content: "d" },
    ]);
    expect(history.map((h) => [h.role, h.content[0].text])).toEqual([["human", "a"], ["assistant", "b"], ["human", "[tool result] r"], ["assistant", "c"]]);
  });

  it("builds the source persona frame with no generation knobs", () => {
    const frame = buildPersonaFrame({ model: "glm-5.1", text: "hi", history: [], uid: A.uid });
    expect(Object.keys(frame).sort()).toEqual([
      "adapty_profile_id", "app_version", "chat_history", "chat_history_truncated", "chat_mode", "client_request_id", "followups_enabled",
      "free_tier_model_selected", "is_refresh", "is_smartify", "is_suggested_input", "media_blob_name", "media_content_type", "message_id",
      "model", "no_media_in_chat", "perplexity_search_enabled", "text", "thread_id", "use_memory", "user_identifier", "web_search_enabled",
    ]);
    expect(frame).toMatchObject({
      app_version: "1.0.0-web", model: "glm-5.1", text: "hi", chat_history: [], chat_history_truncated: false, chat_mode: "chat",
      use_memory: false, web_search_enabled: false, user_identifier: A.uid, no_media_in_chat: true, media_blob_name: "", adapty_profile_id: null,
    });
    for (const id of [frame.message_id, frame.client_request_id, frame.thread_id]) expect(id).toMatch(UUID);
  });
});

describe("frame parser", () => {
  it("reassembles a frame split across socket messages and keeps order", () => {
    const parser = new UcFrameParser();
    const whole = `${reasoning("think")}\n${textDelta("Hel")}\n${textDelta("lo")}\n${done("Hello")}`;
    const cut = whole.indexOf("lo\"") - 3;
    const events = [...parser.feed(whole.slice(0, 10)), ...parser.feed(whole.slice(10, cut)), ...parser.feed(whole.slice(cut))];
    expect(events).toEqual([
      { kind: "reasoning", text: "think" },
      { kind: "delta", text: "Hel" },
      { kind: "delta", text: "lo" },
      { kind: "done", text: "Hello" },
    ]);
    expect(parser.done).toBe(true);
  });

  it("skips keepalives and non-object JSON, and stops at the first terminal", () => {
    const parser = new UcFrameParser();
    expect(parser.feed("ping")).toEqual([]);
    expect(parser.feed(`${textDelta("a")}\n[1,2]\n42\n${f({ message_type: "memory_status" })}\n${done()}\n${textDelta("late")}`)).toEqual([
      { kind: "delta", text: "a" },
      { kind: "done", text: "a" },
    ]);
    expect(parser.feed(textDelta("after"))).toEqual([]);
  });

  it("classifies quota, auth and generation failures", () => {
    expect(new UcFrameParser().feed(f({ type: "error", code: "message_limit_exceeded", message: "Daily limit", next_reset: "2026-11-28T00:00:00Z" }))).toEqual([{
      kind: "error", code: "message_limit_exceeded", nextReset: "2026-11-28T00:00:00Z",
      text: "uc_message_limit_exceeded: Daily limit (code=message_limit_exceeded, next_reset=2026-11-28T00:00:00Z)",
    }]);
    expect(new UcFrameParser().feed(f({ code: "unauthorized" }))[0]).toMatchObject({ kind: "error", code: "unauthorized" });
    expect(new UcFrameParser().feed(f({ message_type: "generation_failed", direct_mode_error: "boom" }))).toEqual([{ kind: "error", code: "generation_failed", text: "boom" }]);
  });

  it("refuses an unterminated frame past the carry cap", () => {
    const parser = new UcFrameParser({ maxCarryBytes: 8 });
    expect(() => parser.feed("{\"message_type\":\"text\"")).toThrow("carry-too-large");
  });
});

describe("wire contract", () => {
  it("mints with only the selected jar and opens the source socket with Origin only", async () => {
    clock = 1_800_000_000_000;
    scripts.push(answers(done("Hi there")));
    const result = await run(executor(), { body: userBody("hello", { max_tokens: 64, temperature: 0.2, reasoning_effort: "high" }) });
    expect(result.response.status).toBe(200);
    expect(clerkCalls).toHaveLength(1);
    expect(clerkCalls[0].url).toBe(`${CLERK}/v1/client/sessions/${A.sid}/tokens?__clerk_api_version=2025-11-10&_clerk_js_version=5.127.1`);
    expect(clerkCalls[0].init.headers.Cookie).toBe(`__client=${A.client}; __cf_bm=${A.cf}`);
    expect(clerkCalls[0].init.headers.Authorization).toBeUndefined();
    const [socket] = sockets;
    expect(socket.url).toBe(`${WS_HOST}/${A.uid}?token=${encodeURIComponent(jwtAt(A))}&_t=${socket.url.split("_t=")[1]}`);
    expect(socket.url.split("_t=")[1]).toMatch(/^\d{13}$/);
    expect(socket.options.headers).toEqual({ Origin: "https://uncensored.com" });
    expect(socket.options).toMatchObject({ followRedirects: false, maxRedirects: 0 });
    expect(socket.sent).toHaveLength(1);
    const frame = socket.sent[0];
    expect(frame).toMatchObject({ model: "claude-opus-47", user_identifier: A.uid, chat_history: [], app_version: "1.0.0-web" });
    expect(frame.text).toBe(`${staged.UC_IDENTITY_STEER}\n\n---\n\nhello`);
    for (const knob of ["max_tokens", "temperature", "reasoning_effort", "direct_params", "tools"]) expect(frame).not.toHaveProperty(knob);
    expect(result.url).toBe("https://internal-6.pubyar.com");
    expect(result.headers).toEqual({ Origin: "https://uncensored.com" });
    expect(result.transformedBody).toEqual(frame);
    await expectNoLeak(result, [jwtAt(A)]);
    expect(socket.closed).toBe(true);
  });

  it("answers a buffered chat.completion with reasoning, finish and estimated usage", async () => {
    scripts.push(answers(status("thinking"), reasoning("Let me "), reasoning("think."), textDelta("Hello"), `${textDelta(" world")}\n${done("Hello world")}`));
    const result = await run(executor(), { model: "uc/deepseek-r1" });
    const body = await result.response.json();
    expect(body).toMatchObject({
      object: "chat.completion",
      model: "uc/deepseek-r1",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello world", reasoning_content: "Let me think." }, finish_reason: "stop" }],
    });
    const promptTokens = Math.ceil(sockets[0].sent[0].text.length / 4);
    expect(body.usage).toEqual({ prompt_tokens: promptTokens, completion_tokens: Math.ceil("Let me think.Hello world".length / 4), total_tokens: promptTokens + 6 });
    expect(body.id).toMatch(/^chatcmpl-uc-/);
    expect(sockets[0].sent[0].model).toBe("deepseek-r1");
  });

  it("streams reasoning and deltas in order across split frames, then finish with usage and [DONE]", async () => {
    const tail = `${textDelta(" world")}\n${done("Hello world!")}\n`;
    scripts.push(answers(reasoning("hmm"), textDelta("Hel").slice(0, 12), textDelta("Hel").slice(12) + "\n" + textDelta("lo"), tail.slice(0, 7), tail.slice(7)));
    const result = await run(executor(), { stream: true });
    expect(result.response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const events = await sseEvents(result.response);
    expect(deltas(events)).toEqual([
      { role: "assistant" },
      { reasoning_content: "hmm" },
      { content: "Hel" },
      { content: "lo" },
      { content: " world" },
      { content: "!" },
      {},
    ]);
    expect(finishes(events)).toEqual(["stop"]);
    expect(events.at(-1).usage.completion_tokens).toBe(Math.ceil("hmmHello world!".length / 4));
    expect(new Set(events.map((e) => e.id)).size).toBe(1);
  });

  it("streams a raw_text-only short answer as one content delta", async () => {
    scripts.push(answers(done("  Short answer.  ")));
    const events = await sseEvents((await run(executor(), { stream: true })).response);
    expect(deltas(events)).toEqual([{ role: "assistant" }, { content: "Short answer." }, {}]);
  });

  it("does not repeat streamed text when raw_text diverges from the deltas", async () => {
    scripts.push(answers(textDelta("abc"), done("xyz")));
    const events = await sseEvents((await run(executor(), { stream: true })).response);
    expect(deltas(events).map((d) => d.content).filter(Boolean)).toEqual(["abc"]);
  });
});

describe("gateway API formats", () => {
  it("translates a Claude Messages request and streams back Claude events", async () => {
    scripts.push(answers(reasoning("Considering."), textDelta("Bonjour"), done("Bonjour")));
    const claudeBody = {
      model: "uc/claude-opus-47",
      max_tokens: 256,
      system: "Answer in French.",
      stream: true,
      messages: [
        { role: "user", content: [{ type: "text", text: "Say hi" }] },
        { role: "assistant", content: [{ type: "text", text: "Hi?" }] },
        { role: "user", content: [{ type: "text", text: "In French" }] },
      ],
    };
    const openaiBody = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "uc/claude-opus-47", claudeBody, true);
    const result = await run(executor(), { model: "uc/claude-opus-47", body: openaiBody, stream: true });
    const frame = sockets[0].sent[0];
    expect(frame.chat_history).toEqual([
      { role: "human", content: [{ type: "text", text: "Say hi" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi?" }] },
    ]);
    expect(frame.text).toMatch(/Answer in French\./);
    expect(frame.text.endsWith("---\n\nIn French")).toBe(true);
    expect(frame).not.toHaveProperty("max_tokens");

    const events = translateStream(await sseEvents(result.response), FORMATS.CLAUDE);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("message_start");
    expect(types.at(-1)).toBe("message_stop");
    const thinking = events.filter((e) => e.delta?.type === "thinking_delta").map((e) => e.delta.thinking).join("");
    const text = events.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
    expect(thinking).toBe("Considering.");
    expect(text).toBe("Bonjour");
    expect(events.find((e) => e.type === "message_delta").delta.stop_reason).toBe("end_turn");
  });

  it("translates a Responses request and streams back a completed response", async () => {
    scripts.push(answers(textDelta("Four"), done("Four")));
    const responsesBody = { model: "uc/glm-5.1", instructions: "Be terse.", input: [{ role: "user", content: [{ type: "input_text", text: "2+2?" }] }], stream: true };
    const openaiBody = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "uc/glm-5.1", responsesBody, true);
    const result = await run(executor(), { model: "uc/glm-5.1", body: openaiBody, stream: true });
    expect(sockets[0].sent[0].text).toMatch(/^Be terse\.\n\n.*---\n\n2\+2\?$/s);
    const events = translateStream(await sseEvents(result.response), FORMATS.OPENAI_RESPONSES);
    const names = events.map((e) => e.event);
    expect(names).toContain("response.output_text.delta");
    expect(names.filter((n) => /^response\.(completed|failed|incomplete)$/.test(n))).toEqual(["response.completed"]);
    const completed = events.find((e) => e.event === "response.completed").data.response;
    expect(JSON.stringify(completed.output)).toContain("Four");
  });

  it("turns a prompted tool call into a Claude tool_use with the source id seed", async () => {
    scripts.push(answers(done("<tool_call>{\"name\":\"get_weather\",\"arguments\":{\"city\":\"Paris\"}}</tool_call>")));
    const claudeBody = {
      model: "uc/claude-opus-47", max_tokens: 100, stream: true,
      tools: [{ name: "get_weather", description: "Weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
      messages: [{ role: "user", content: "Weather in Paris?" }],
    };
    const openaiBody = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "uc/claude-opus-47", claudeBody, true);
    const result = await run(executor(), { model: "uc/claude-opus-47", body: openaiBody, stream: true });
    const frame = sockets[0].sent[0];
    expect(frame.text).toMatch(/Available tools:\n- get_weather: Weather/);
    expect(frame).not.toHaveProperty("tools");
    const chat = await sseEvents(result.response);
    expect(deltas(chat)[1]).toEqual({ tool_calls: [{ index: 0, id: "uc_0", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Paris\"}" } }] });
    expect(finishes(chat)).toEqual(["tool_calls"]);
    const events = translateStream(chat, FORMATS.CLAUDE);
    const toolUse = events.find((e) => e.type === "content_block_start" && e.content_block.type === "tool_use").content_block;
    expect(toolUse).toMatchObject({ id: "uc_0", name: "get_weather" });
    expect(events.filter((e) => e.delta?.type === "input_json_delta").map((e) => e.delta.partial_json).join("")).toBe("{\"city\":\"Paris\"}");
    expect(events.find((e) => e.type === "message_delta").delta.stop_reason).toBe("tool_use");
  });

  it("carries a Claude tool_result turn into the next persona frame", async () => {
    scripts.push(answers(done("It is sunny in Paris.")));
    const claudeBody = {
      model: "uc/claude-opus-47", max_tokens: 100,
      tools: [{ name: "get_weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
      messages: [
        { role: "user", content: "Weather in Paris?" },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Paris" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "sunny, 21C" }] },
      ],
    };
    const openaiBody = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "uc/claude-opus-47", claudeBody, false);
    const result = await run(executor(), { model: "uc/claude-opus-47", body: openaiBody });
    const frame = sockets[0].sent[0];
    expect(frame.chat_history.at(-1).content[0].text).toContain("<tool_call>{\"name\":\"get_weather\",\"arguments\":{\"city\":\"Paris\"}}</tool_call>");
    expect(frame.text).toContain("The get_weather tool already ran and returned:\nsunny, 21C");
    const body = await result.response.json();
    expect(body.choices[0]).toMatchObject({ message: { content: "It is sunny in Paris." }, finish_reason: "stop" });
  });

  it("translates a Responses function call", async () => {
    scripts.push(answers(done("<tool>{\"name\":\"lookup\",\"arguments\":{\"q\":\"x\"}}</tool>")));
    const responsesBody = {
      model: "uc/kimi-k2.5", stream: true, input: "find x",
      tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: { q: { type: "string" } } } }],
    };
    const openaiBody = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "uc/kimi-k2.5", responsesBody, true);
    const result = await run(executor(), { model: "uc/kimi-k2.5", body: openaiBody, stream: true });
    const events = translateStream(await sseEvents(result.response), FORMATS.OPENAI_RESPONSES);
    const completed = events.find((e) => e.event === "response.completed").data.response;
    expect(completed.output.find((o) => o.type === "function_call")).toMatchObject({ name: "lookup", arguments: "{\"q\":\"x\"}" });
  });
});

describe("tool dialects", () => {
  const tools = [{ type: "function", function: { name: "run_terminal", parameters: { type: "object", properties: { command: { type: "string" } } } } }];

  it("leads gpt-5.5 tool turns with the code-style preamble and parses code-style calls", async () => {
    scripts.push(answers(done("run_terminal(\"ls -la\")")));
    const result = await run(executor(), { model: "gpt-5.5", body: userBody("list files", { tools }) });
    expect(sockets[0].sent[0].text.startsWith(`${staged.UC_CODESTYLE_HEADER}\n\n`)).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0]).toMatchObject({
      message: { content: null, tool_calls: [{ id: "uc_0", type: "function", function: { name: "run_terminal", arguments: "{\"command\":\"ls -la\"}" } }] },
      finish_reason: "tool_calls",
    });
  });

  it("parses the Gemini <tool_code> dialect", async () => {
    scripts.push(answers(done("<tool_code>\nprint(hermes_tools.run_terminal(command='pwd'))\n</tool_code>")));
    const body = await (await run(executor(), { model: "gemini-emotional", body: userBody("where am i", { tools }) })).response.json();
    expect(body.choices[0].message.tool_calls[0].function).toEqual({ name: "run_terminal", arguments: "{\"command\":\"pwd\"}" });
    expect(sockets[0].sent[0].text.startsWith(staged.UC_CODESTYLE_HEADER)).toBe(false);
  });

  it("returns a refusal as the answer and never opens a second socket", async () => {
    scripts.push(answers(done("I'm sorry, but I can't assist with that.")));
    const body = await (await run(executor(), { model: "glm-5.1", body: userBody("x", { tools }) })).response.json();
    expect(body.choices[0]).toMatchObject({ message: { content: "I'm sorry, but I can't assist with that." }, finish_reason: "stop" });
    expect(sockets).toHaveLength(1);
  });

  it("ignores undeclared names in code-style text", () => {
    expect(staged.parseUcExtraDialects("print(\"hi\")\nrm(\"x\")", tools)).toEqual([]);
  });
});

describe("account isolation and token renewal", () => {
  it("uses each connection's own jar, uid and JWT", async () => {
    scripts.push(answers(done("a")), answers(done("b")));
    const ex = executor();
    await run(ex, { credentials: credsFor(A) });
    await run(ex, { credentials: credsFor(B) });
    expect(clerkCalls.map((c) => c.path)).toEqual([`/v1/client/sessions/${A.sid}/tokens`, `/v1/client/sessions/${B.sid}/tokens`]);
    expect(clerkCalls[1].init.headers.Cookie).toBe(`__client=${B.client}; __cf_bm=${B.cf}`);
    expect(sockets[0].url).toContain(`/ws/${A.uid}?token=${encodeURIComponent(jwtAt(A))}`);
    expect(sockets[1].url).toContain(`/ws/${B.uid}?token=${encodeURIComponent(jwtAt(B))}`);
    expect(sockets[1].sent[0].user_identifier).toBe(B.uid);
  });

  it("reuses a fresh token and re-mints inside the source 8 s skew", async () => {
    scripts.push(answers(done("1")), answers(done("2")), answers(done("3")));
    const ex = executor();
    await run(ex);
    clock += 50_000;
    await run(ex);
    expect(clerkCalls).toHaveLength(1);
    clock += 2_001;
    mints[A.sid] = mintOk(A, 60, "renewed");
    await run(ex);
    expect(clerkCalls).toHaveLength(2);
    expect(sockets[2].url).toContain(encodeURIComponent(jwtAt(A, 60, "renewed")));
  });

  it("persists a rotated jar for the same connection only", async () => {
    mints[A.sid] = () => reply(200, { jwt: jwtAt(A) }, ["__client=SYNTHETIC-client-a2; Path=/; Domain=.uncensored.com"]);
    scripts.push(answers(done("ok")));
    const onCredentialsRefreshed = vi.fn();
    const creds = credsFor(A);
    await run(executor(), { credentials: creds, onCredentialsRefreshed });
    expect(onCredentialsRefreshed).toHaveBeenCalledTimes(1);
    const updated = onCredentialsRefreshed.mock.calls[0][0];
    expect(updated.connectionId).toBe("conn-a");
    expect(updated.providerSpecificData).toMatchObject({ ucClientCookie: "SYNTHETIC-client-a2", ucSid: A.sid, ucUid: A.uid, ucAuthSource: "email-code" });
    expect(updated.providerSpecificData.ucCookies).toEqual({ __client: "SYNTHETIC-client-a2", __cf_bm: A.cf });
    expect(creds.providerSpecificData.ucClientCookie).toBe(A.client);
  });

  it("refuses a minted JWT that names another account", async () => {
    mints[A.sid] = mintOk(B);
    const result = await run(executor());
    expect(result.response.status).toBe(401);
    expect((await result.response.json()).error.code).toBe("uc_identity");
    expect(sockets).toEqual([]);
  });
});

describe("opt-in and credential guards", () => {
  it("is disabled without the operator opt-in", async () => {
    const result = await run(executor({ env: {} }));
    expect(result.response.status).toBe(403);
    expect((await result.response.json()).error.code).toBe("uc_disabled");
    expect(clerkCalls).toEqual([]);
  });

  it("needs metadata written by the staged sign-in module", async () => {
    for (const extra of [{ ucAuthSource: undefined }, { ucAuthSource: "browser" }, { ucSignedInAt: "yesterday" }]) {
      const result = await run(executor(), { credentials: credsFor(A, extra) });
      expect(result.response.status).toBe(401);
      expect((await result.response.json()).error.code).toBe("uc_unconfigured");
    }
    expect(clerkCalls).toEqual([]);
  });

  it("never uses an API key, a Bearer header or uc-direct", async () => {
    const result = await run(executor(), { credentials: { apiKey: "uai_SYNTHETICdirectkey", providerSpecificData: {} } });
    expect(result.response.status).toBe(401);
    const text = await result.response.text();
    expect(text).not.toContain("uai_SYNTHETICdirectkey");
    expect(clerkCalls).toEqual([]);
    expect(sockets).toEqual([]);
  });

  it("refuses media input instead of dropping it", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }] };
    const result = await run(executor(), { body });
    expect(result.response.status).toBe(400);
    expect((await result.response.json()).error.code).toBe("uc_media_unsupported");
    expect(clerkCalls).toEqual([]);
  });

  it("refuses a request without a user turn", async () => {
    expect((await run(executor(), { body: { messages: [] } })).response.status).toBe(400);
    expect((await run(executor(), { body: { messages: [{ role: "system", content: "x" }] } })).response.status).toBe(400);
    expect(clerkCalls).toEqual([]);
  });
});

describe("auth failures fail closed", () => {
  it("maps a Clerk challenge to 403 without opening a socket", async () => {
    mints[A.sid] = () => reply(403, { errors: [{ code: "captcha_required", message: `challenge ${A.client}` }] });
    const result = await run(executor());
    expect(result.response.status).toBe(403);
    await expectNoLeak(result);
    expect((await result.response.json()).error.code).toBe("uc_auth_challenge");
    expect(sockets).toEqual([]);
  });

  it("maps a revoked session to 401", async () => {
    mints[A.sid] = () => reply(401, { errors: [{ code: "session_revoked" }] });
    const result = await run(executor());
    expect(result.response.status).toBe(401);
    expect((await result.response.json()).error.code).toBe("uc_auth_error");
  });

  it("drops the cached JWT after a socket 401 and does not retry", async () => {
    scripts.push((socket) => socket.listeners["unexpected-response"]({}, { statusCode: 401, headers: {}, resume() {} }));
    const ex = executor();
    const result = await run(ex);
    expect(result.response.status).toBe(401);
    expect(result.acceptedTurn).toBeUndefined();
    expect(sockets).toHaveLength(1);
    expect(clerkCalls).toHaveLength(1);
    scripts.push(answers(done("ok")));
    await run(ex);
    expect(clerkCalls).toHaveLength(2);
  });

  it("treats an unauthorized frame as an accepted failed turn and drops the JWT", async () => {
    const jwt = jwtAt(A);
    scripts.push(answers(f({ type: "error", code: "unauthorized", message: `bad token ${jwt}` })));
    const ex = executor();
    const result = await run(ex);
    expect(result.response.status).toBe(401);
    expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "upstream-error" });
    await expectNoLeak(result, [jwt]);
    scripts.push(answers(done("ok")));
    await run(ex);
    expect(clerkCalls).toHaveLength(2);
  });
});

describe("quota, malformed frames and closed sockets", () => {
  it("maps a daily quota frame to 429 with the reset", async () => {
    scripts.push(answers(f({ type: "error", code: "message_limit_exceeded", message: "Daily message limit reached", next_reset: "2026-11-28T00:00:00Z" })));
    const result = await run(executor(), { stream: true });
    expect(result.response.status).toBe(429);
    const body = await result.response.json();
    expect(body.error).toMatchObject({ code: "uc_message_limit_exceeded", type: "rate_limit_error" });
    expect(body.error.message).toContain("next_reset=2026-11-28T00:00:00Z");
    expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "upstream-error" });
  });

  it("maps paywall and rate frames to 429 and generation_failed to 502", async () => {
    scripts.push(answers(f({ type: "error", code: "paywall_exceeded" })), answers(f({ code: "rate_limit_exceeded" })), answers(f({ message_type: "generation_failed" })));
    const ex = executor();
    expect((await (await run(ex)).response.json()).error.code).toBe("uc_paywall_exceeded");
    expect((await (await run(ex)).response.json()).error.code).toBe("uc_rate_limit_exceeded");
    const failed = await run(ex);
    expect(failed.response.status).toBe(502);
    expect((await failed.response.json()).error.code).toBe("uc_generation_failed");
  });

  it("skips malformed frames and still completes", async () => {
    scripts.push(answers("not json", "[1]", "{\"message_type\":\"text\",\"text\":5}", textDelta("fine"), done()));
    const body = await (await run(executor())).response.json();
    expect(body.choices[0].message.content).toBe("fine");
  });

  it("fails a buffered turn whose socket closed before end_of_stream", async () => {
    scripts.push(answers(textDelta("partial"), (s) => s.end(1006)));
    const result = await run(executor());
    expect(result.response.status).toBe(502);
    expect((await result.response.json()).error.code).toBe("uc_truncated");
    expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "closed" });
    expect(sockets).toHaveLength(1);
  });

  it("ends a stream that lost its socket after output with finish_reason error, never stop", async () => {
    scripts.push(answers(textDelta("partial"), (s) => s.end(1006)));
    const result = await run(executor(), { stream: true });
    expect(result.response.status).toBe(200);
    const events = await sseEvents(result.response);
    expect(deltas(events).slice(0, 2)).toEqual([{ role: "assistant" }, { content: "partial" }]);
    expect(finishes(events)).toEqual(["error"]);
    expect(events.at(-1).error.code).toBe("uc_truncated");
    const claude = translateStream(events, FORMATS.CLAUDE);
    expect(claude.filter((e) => e.type === "error")).toHaveLength(1);
    expect(claude.some((e) => e.delta?.stop_reason)).toBe(false);
    const responses = translateStream(events, FORMATS.OPENAI_RESPONSES);
    expect(responses.map((e) => e.event).filter((n) => /^response\.(completed|failed|incomplete)$/.test(n))).toEqual(["response.failed"]);
    expect(sockets).toHaveLength(1);
  });

  it("redacts an error frame that arrives after streamed output and drops the JWT", async () => {
    const jwt = jwtAt(A);
    scripts.push(answers(reasoning("r"), f({ type: "error", code: "forbidden", message: `nope ${jwt} ${A.client}` })));
    const ex = executor();
    const result = await run(ex, { stream: true });
    const text = await result.response.text();
    expect(text).toContain("\"finish_reason\":\"error\"");
    expect(text).toContain("uc_auth_error");
    for (const secret of [jwt, A.client]) expect(text).not.toContain(secret);
    scripts.push(answers(done("ok")));
    await run(ex);
    expect(clerkCalls).toHaveLength(2);
  });

  it("surfaces a soft-error apology as a retryable 502 before committing a stream", async () => {
    scripts.push(answers(done("Server overloaded temporarily. Please switch models and try again.")));
    const result = await run(executor(), { stream: true });
    expect(result.response.status).toBe(502);
    expect((await result.response.json()).error.code).toBe("uc_soft_error");
  });

  it("fails an empty answer", async () => {
    scripts.push(answers(done("")));
    const result = await run(executor());
    expect((await result.response.json()).error.code).toBe("uc_empty_response");
  });

  it("refuses an oversize frame", async () => {
    scripts.push(answers(textDelta("x".repeat(200))));
    const result = await run(executor({ maxFrameBytes: 64 }));
    expect(result.response.status).toBe(502);
    expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "too-large" });
    expect(sockets[0].terminated).toBe(true);
  });
});

describe("abort and deadlines", () => {
  it("throws before any network call when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run(executor(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(clerkCalls).toEqual([]);
  });

  it("aborts a buffered turn and terminates the socket", async () => {
    const controller = new AbortController();
    scripts.push(answers(textDelta("a"), () => controller.abort()));
    await expect(run(executor(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(sockets[0].terminated).toBe(true);
  });

  it("terminates the socket when the stream consumer cancels", async () => {
    scripts.push(answers(textDelta("a")));
    const result = await run(executor(), { stream: true });
    const reader = result.response.body.getReader();
    await reader.read();
    await reader.cancel();
    expect(sockets[0].terminated).toBe(true);
  });

  it("fails a socket that never opens within the handshake deadline, with nothing sent", async () => {
    scripts.push(() => {});
    const result = await run(executor({ handshakeTimeoutMs: 5 }));
    expect(result.response.status).toBe(504);
    expect(result.acceptedTurn).toBeUndefined();
    expect(sockets[0].sent).toEqual([]);
  });

  it("marks an idle turn after the frame left as uncertain", async () => {
    scripts.push((s) => s.open());
    const result = await run(executor({ idleTimeoutMs: 5 }));
    expect(result.response.status).toBe(504);
    expect(result.acceptedTurn).toEqual({ state: "uncertain", outcome: "idle" });
    expect(sockets).toHaveLength(1);
  });

  it("bounds the whole turn even while frames keep arriving", async () => {
    scripts.push((s) => {
      s.open();
      const timer = setInterval(() => (s.terminated ? clearInterval(timer) : s.message(status("busy"))), 2);
    });
    const result = await run(executor({ timeoutMs: 30, idleTimeoutMs: 20 }));
    expect(result.response.status).toBe(504);
    expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "timeout" });
  });

  it("fails a connect error before send as a plain 502", async () => {
    scripts.push((s) => s.onerror?.(new Error("ECONNREFUSED")));
    const result = await run(executor());
    expect(result.response.status).toBe(502);
    expect(result.acceptedTurn).toBeUndefined();
  });
});
