// SYNTX.ai native chat with Bearer JWT auth, staged and unregistered (#1234,
// #2034). Closed mocks only: every SYNTX call goes through a synthetic
// transport that fails the test on an unexpected request, DNS is a synthetic
// lookup, and every JWT, chat uuid and stream URL is synthetic. Wire shapes
// follow OmniRoute c71f0065 (executors/syntx.ts, syntxChat.ts,
// syntxExecute.ts, services/syntxAuth.ts, syntxSessions.ts, syntxModels.ts,
// registry/syntx/index.ts). Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import "../translator/registerAll.js";

import * as staged from "../../open-sse/services/providerParity/native-syntx-chat-auth/index.js";
import {
  SYNTX_FALLBACK_MODELS,
  SYNTX_PROVIDER_DEFINITION,
  SYNTX_REGISTRY_MODELS,
  SyntxChatExecutor,
  buildSyntxGenerateBody,
  createSyntxSessionStore,
  extractSyntxSseEvent,
  inferSyntxAiName,
  isSyntxStreamUrl,
  looksLikeJwt,
  mapSyntxModel,
  parseSyntxModelsCatalog,
  parseSyntxToolCalls,
  readSyntxSse,
  resolveSyntxToken,
} from "../../open-sse/services/providerParity/native-syntx-chat-auth/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";

const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-syntx-chat-auth/registration.json", import.meta.url), "utf8"));

const API = "https://api.syntx.ai";
const SSE = "https://sse.syntx.ai";
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (tag) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: `SYNTHETIC-${tag}` })}.SYNTHETICsig${tag}`;
const JWT_A = jwt("acctA");
const JWT_B = jwt("acctB");
const credsA = { apiKey: JWT_A, connectionId: "conn-a" };
const credsB = { apiKey: JWT_B, connectionId: "conn-b" };

// ── synthetic SYNTX server ───────────────────────────────────────────────────
let calls;
let server;
const encoder = new TextEncoder();

function streamOf(parts, { hang = false } = {}) {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      if (!hang) controller.close();
    },
  });
}
const sseText = (...events) => events.map((e) => (e === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(e)}\n\n`)).join("");
const content = (text) => ({ type: "content", content: text });
const usageFinal = (input, output) => ({ type: "usage_final", tokens_input: input, tokens_output: output });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function resetServer() {
  calls = [];
  server = {
    chatSeq: 0,
    createStatus: 200,
    generate: [],
    streams: {},
    uploads: [],
    uploadUrl: (n) => `https://r2.syntx.ai/uploads/SYNTHETIC-${n}.png`,
    images: {},
    models: null,
  };
}

/** Queue one generate answer: a stream URL with an SSE body, or a custom response. */
function queueTurn(events, { hang = false, status, raw } = {}) {
  const n = server.generate.length + 1;
  const streamUrl = `${SSE}/stream/SYNTHETIC-job-${n}`;
  server.generate.push(raw ?? (status ? null : { stream_url: streamUrl }));
  if (status) server.generate[server.generate.length - 1] = { status };
  if (events) server.streams[streamUrl] = () => new Response(streamOf([typeof events === "string" ? events : sseText(...events)], { hang }), { headers: { "content-type": "text/event-stream" } });
  return streamUrl;
}

const headerOf = (init, name) => {
  const headers = init?.headers ?? {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
};

async function fetchImpl(url, init = {}) {
  const method = init.method ?? "GET";
  const entry = { url: String(url), method, init, body: init.body };
  calls.push(entry);
  const u = new URL(url);
  if (u.origin === API) {
    if (u.pathname === "/api/v1/chats" && method === "POST") {
      if (server.createStatus !== 200) return json({ detail: `denied ${headerOf(init, "authorization")}` }, server.createStatus);
      server.chatSeq += 1;
      return json({ uuid: `0000000${server.chatSeq}-synth-4000-8000-chat0000000${server.chatSeq}` });
    }
    if (u.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      server.uploads.push(entry);
      const n = server.uploads.length;
      if (server.uploadResponse) return server.uploadResponse(n);
      return json({ files: [{ url: server.uploadUrl(n), object_type: "image" }] });
    }
    if (u.pathname === "/api/v1/user/settings" && method === "PUT") return json({ ok: true });
    if (u.pathname === "/api/v1/llm/generate" && method === "POST") {
      const next = server.generate.shift();
      if (!next) throw new Error(`unexpected generate ${url}`);
      if (next.throws) throw new TypeError("fetch failed");
      if (next.status) return json({ detail: `upstream refused token ${headerOf(init, "authorization")}` }, next.status, next.headers ?? {});
      return json(next);
    }
    if (u.pathname === "/api/v1/llm/models" && method === "GET") {
      if (!server.models) return json({ detail: "nope" }, 500);
      return json(server.models);
    }
  }
  if (u.origin === SSE && server.streams[String(url)]) return server.streams[String(url)]();
  if (server.images[String(url)]) return server.images[String(url)](init);
  throw new Error(`unexpected request ${method} ${url}`);
}

const DNS = { "img.example.com": "93.184.216.34", "evil.example.com": "127.0.0.1", "hop.example.com": "93.184.216.35" };
const lookup = async (host) => {
  if (!DNS[host]) throw new Error("ENOTFOUND");
  return [{ address: DNS[host], family: 4 }];
};

const executor = (extra = {}) => new SyntxChatExecutor({ fetchImpl, lookup, ...extra });
const userBody = (text = "hello", extra = {}) => ({ messages: [{ role: "user", content: text }], ...extra });
const run = (ex, { model = "syntx/claude-sonnet-4-6", body = userBody(), stream = false, credentials = credsA, ...rest } = {}) =>
  ex.execute({ model, body, stream, credentials, ...rest });

const generateCalls = () => calls.filter((c) => c.url.startsWith(`${API}/api/v1/llm/generate`));
const createCalls = () => calls.filter((c) => c.url === `${API}/api/v1/chats` && c.method === "POST");
const lastGenerateBody = () => JSON.parse(generateCalls().at(-1).body);

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

async function expectNoLeak(result, secrets = [JWT_A, JWT_B]) {
  const text = `${await result.response.clone().text()} ${JSON.stringify({ url: result.url, headers: result.headers, body: result.transformedBody })}`;
  for (const secret of secrets) expect(text).not.toContain(secret);
}

beforeEach(resetServer);

// ── staging ──────────────────────────────────────────────────────────────────
describe("staging", () => {
  it("is not registered anywhere and the manifest names the pinned source", () => {
    expect(PROVIDERS.syntx).toBeUndefined();
    expect(PROVIDERS.stx).toBeUndefined();
    expect(hasSpecializedExecutor("syntx")).toBe(false);
    expect(hasSpecializedExecutor("stx")).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(REGISTRATION.issue).toBe("#1234");
    expect(REGISTRATION.relatedIssues).toContain("#2034");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.files).toEqual(expect.arrayContaining([
      "open-sse/executors/syntx.ts", "open-sse/executors/syntxChat.ts", "open-sse/executors/syntxExecute.ts",
      "open-sse/services/syntxAuth.ts", "open-sse/services/syntxSessions.ts", "open-sse/services/syntxModels.ts",
      "open-sse/config/providers/registry/syntx/index.ts",
    ]));
    expect(REGISTRATION.module).toBe("open-sse/services/providerParity/native-syntx-chat-auth/index.js");
    expect(typeof staged.SyntxChatExecutor).toBe("function");
  });

  it("carries the source registry entry and the 34 seed models", () => {
    expect(SYNTX_PROVIDER_DEFINITION).toMatchObject({
      id: "syntx", alias: "stx", format: "openai", baseUrl: "https://api.syntx.ai/api/v1",
      authType: "apikey", authHeader: "bearer", timeoutMs: 600_000, passthroughModels: true,
    });
    expect(SYNTX_FALLBACK_MODELS).toHaveLength(34);
    expect(SYNTX_REGISTRY_MODELS).toHaveLength(34);
    expect(SYNTX_REGISTRY_MODELS.every((m) => m.toolCalling === true)).toBe(true);
    expect(SYNTX_REGISTRY_MODELS.find((m) => m.id === "claude-sonnet-4-6").supportsVision).toBe(true);
    expect(SYNTX_REGISTRY_MODELS.find((m) => m.id === "deepseek-r1").supportsVision).toBe(false);
  });
});

// ── auth ─────────────────────────────────────────────────────────────────────
describe("token resolution (source syntxAuth.ts)", () => {
  it("prefers accessToken, then apiKey, then providerSpecificData, and a JWT-shaped candidate over any other", () => {
    expect(resolveSyntxToken({ apiKey: JWT_A, accessToken: JWT_B })).toBe(JWT_B);
    expect(resolveSyntxToken({ apiKey: `Bearer ${JWT_A}` })).toBe(JWT_A);
    expect(resolveSyntxToken({ apiKey: "not-a-jwt", providerSpecificData: { accessToken: JWT_B } })).toBe(JWT_B);
    expect(resolveSyntxToken({ apiKey: JSON.stringify({ token: `bearer ${JWT_A}` }) })).toBe(JWT_A);
    expect(resolveSyntxToken({ providerSpecificData: { authorization: `Bearer ${JWT_B}` } })).toBe(JWT_B);
    expect(resolveSyntxToken({ apiKey: "plain" })).toBe("plain");
    expect(looksLikeJwt(JWT_A)).toBe(true);
    expect(looksLikeJwt("eyJonly.two")).toBe(false);
    expect(looksLikeJwt("abc.def.ghi")).toBe(false);
  });

  it("rejects a missing or non-JWT credential with 401 before any network call", async () => {
    for (const credentials of [{}, { apiKey: "sk-not-a-jwt" }]) {
      const result = await run(executor(), { credentials });
      expect(result.response.status).toBe(401);
      expect((await result.response.json()).error.code).toBe("syntx_unconfigured");
    }
    expect(calls).toEqual([]);
  });

  it("sends the source browser headers with Bearer on api.syntx.ai and no Authorization to the stream host", async () => {
    queueTurn([content("hi"), usageFinal(3, 1), "[DONE]"]);
    await run(executor());
    for (const call of calls.filter((c) => c.url.startsWith(API))) {
      expect(headerOf(call.init, "authorization")).toBe(`Bearer ${JWT_A}`);
      expect(headerOf(call.init, "origin")).toBe("https://syntx.ai");
      expect(headerOf(call.init, "referer")).toBe("https://syntx.ai/");
      expect(call.init.redirect).toBe("error");
    }
    const sseCall = calls.find((c) => c.url.startsWith(SSE));
    expect(headerOf(sseCall.init, "authorization")).toBeUndefined();
    expect(headerOf(sseCall.init, "accept")).toBe("text/event-stream");
    expect(headerOf(sseCall.init, "referer")).toBe("https://syntx.ai/");
    expect(sseCall.init.redirect).toBe("error");
  });
});

// ── wire contract ────────────────────────────────────────────────────────────
describe("create chat, generate and the returned SSE (source syntxExecute.ts)", () => {
  it("creates a chat, posts generate with ai_name, reads the stream and answers one chat.completion", async () => {
    queueTurn([content("Hel"), content("lo"), usageFinal(12, 5), "[DONE]"]);
    const result = await run(executor(), { body: userBody("Say hello", { model: "syntx/claude-sonnet-4-6" }) });
    expect(result.response.status).toBe(200);
    expect(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
      `POST ${API}/api/v1/chats`, `POST ${API}/api/v1/llm/generate`, `GET ${SSE}/stream/SYNTHETIC-job-1`,
    ]);
    expect(JSON.parse(createCalls()[0].body)).toEqual({ title: "Say hello", scope: "text" });
    expect(generateCalls()[0].url).toBe(`${API}/api/v1/llm/generate?ai_name=claude`);
    expect(lastGenerateBody()).toEqual({
      chat_uuid: "00000001-synth-4000-8000-chat00000001",
      text: "<user>\nSay hello\n</user>",
      model: "claude-sonnet-4-6",
      thinking: false,
      plan: false,
      deep_research: false,
      tools: ["search", "code", "shell"],
    });
    await expectNoLeak(result);
    const body = await result.response.json();
    expect(body).toMatchObject({
      object: "chat.completion",
      model: "syntx/claude-sonnet-4-6",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    });
    expect(result.headers).toEqual({ authorization: "Bearer <redacted>" });
    expect(result.transformedBody.chat_uuid).toBe("00000001-synth-4000-8000-chat00000001");
  });

  it("streams OpenAI chunks: role, content deltas, stop with usage, [DONE]", async () => {
    queueTurn([content("One "), content("two"), usageFinal(4, 2), "[DONE]"]);
    const result = await run(executor(), { stream: true });
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");
    const events = await sseEvents(result.response);
    expect(deltas(events)).toEqual([{ role: "assistant" }, { content: "One " }, { content: "two" }, {}]);
    expect(finishes(events)).toEqual(["stop"]);
    expect(events.at(-1).usage).toEqual({ prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
    expect(events.every((e) => e.object === "chat.completion.chunk")).toBe(true);
  });

  it("maps model ids as the source: prefixes, auto/default, ai_name inference", () => {
    expect(mapSyntxModel("stx/gemini-3.5-flash")).toBe("gemini-3.5-flash");
    expect(mapSyntxModel("syntx/auto")).toBe("gpt-5-nano-2025-08-07");
    expect(mapSyntxModel("")).toBe("gpt-5-nano-2025-08-07");
    expect(inferSyntxAiName("gpt-5.5")).toBe("chatgpt");
    expect(inferSyntxAiName("sonar")).toBe("perplexity");
    expect(inferSyntxAiName("glm-9")).toBe("zai");
    expect(inferSyntxAiName("unknown-model")).toBe("chatgpt");
  });

  it("sets thinking from the request or a thinking model id, and empty client tools turn native tools off", async () => {
    queueTurn([content("ok"), "[DONE]"]);
    await run(executor(), { body: userBody("think", { reasoning_effort: "high", tools: [] }) });
    expect(lastGenerateBody()).toMatchObject({ thinking: true, tools: [] });
    expect(buildSyntxGenerateBody({ chatUuid: "c", text: "t", model: "m", nativeTools: true, files: [{ object_type: "image", object_url: "u" }] }))
      .toMatchObject({ tools: ["search", "code", "shell"], files: [{ object_type: "image", object_url: "u" }] });
  });

  it("rejects a request with no messages before any network call", async () => {
    const result = await run(executor(), { body: { messages: [] } });
    expect(result.response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("decodes source SSE events and validates the stream URL", () => {
    expect(extractSyntxSseEvent('data: {"type":"content","content":"x"}')).toEqual({ delta: "x" });
    expect(extractSyntxSseEvent("data: [DONE]")).toEqual({ done: true });
    expect(extractSyntxSseEvent('data: {"type":"error","message":"boom"}')).toEqual({ error: "boom" });
    expect(extractSyntxSseEvent("data: {broken")).toEqual({});
    expect(isSyntxStreamUrl(`${SSE}/stream/abc`)).toBe(true);
    for (const bad of ["http://sse.syntx.ai/stream/a", "https://evil.example/stream/a", `${SSE}/other/a`, "https://u:p@sse.syntx.ai/stream/a", "https://sse.syntx.ai:8443/stream/a", "not a url"]) {
      expect(isSyntxStreamUrl(bad)).toBe(false);
    }
  });
});

// ── multiturn and sessions ───────────────────────────────────────────────────
describe("chat_uuid continuity (source syntxSessions.ts)", () => {
  it("reuses the chat for a follow-up and sends only the new user turn", async () => {
    const ex = executor();
    queueTurn([content("Paris."), "[DONE]"]);
    await run(ex, { body: userBody("Capital of France?") });
    queueTurn([content("About 2 million."), "[DONE]"]);
    const result = await run(ex, { body: { messages: [
      { role: "user", content: "Capital of France?" },
      { role: "assistant", content: "Paris." },
      { role: "user", content: "Population?" },
    ] } });
    expect(result.response.status).toBe(200);
    expect(createCalls()).toHaveLength(1);
    expect(lastGenerateBody()).toMatchObject({ chat_uuid: "00000001-synth-4000-8000-chat00000001", text: "Population?" });
  });

  it("keeps chats account-scoped: the same history under another token opens a new chat", async () => {
    const ex = executor();
    queueTurn([content("A"), "[DONE]"]);
    await run(ex, { body: userBody("Hi") });
    queueTurn([content("B"), "[DONE]"]);
    await run(ex, { credentials: credsB, body: { messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "A" }, { role: "user", content: "next" }] } });
    expect(createCalls()).toHaveLength(2);
    expect(headerOf(createCalls()[1].init, "authorization")).toBe(`Bearer ${JWT_B}`);
    expect(lastGenerateBody().chat_uuid).toBe("00000002-synth-4000-8000-chat00000002");
    expect(lastGenerateBody().text).toContain("<user>\nnext\n</user>");
  });

  it("a re-pasted token on the same connection does not inherit the previous chat", async () => {
    const ex = executor();
    queueTurn([content("A"), "[DONE]"]);
    await run(ex, { body: userBody("Hi") });
    queueTurn([content("B"), "[DONE]"]);
    await run(ex, { credentials: { apiKey: JWT_B, connectionId: "conn-a" }, body: { messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "A" }, { role: "user", content: "more" }] } });
    expect(createCalls()).toHaveLength(2);
  });

  it("opens a new chat for a Claude Code /new envelope and drops the envelope", async () => {
    const ex = executor();
    queueTurn([content("A"), "[DONE]"]);
    await run(ex, { body: userBody("Hi") });
    queueTurn([content("B"), "[DONE]"]);
    await run(ex, { body: { messages: [
      { role: "user", content: "Hi" }, { role: "assistant", content: "A" },
      { role: "user", content: "<command-name>/new</command-name><command-message>new</command-message> start fresh" },
    ] } });
    expect(createCalls()).toHaveLength(2);
    expect(lastGenerateBody().text).toBe("<user>\nstart fresh\n</user>");
  });

  it("rolls over to a new chat with a handoff transcript after 700 generates", async () => {
    const sessions = createSyntxSessionStore();
    const ex = executor({ sessions });
    queueTurn([content("A"), "[DONE]"]);
    await run(ex, { body: userBody("Hi") });
    sessions.setGenerateCountForTesting("00000001-synth-4000-8000-chat00000001", 700);
    queueTurn([content("B"), "[DONE]"]);
    await run(ex, { body: { messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "A" }, { role: "user", content: "go on" }] } });
    expect(createCalls()).toHaveLength(2);
    expect(JSON.parse(createCalls()[1].body).title).toBe("Hi");
    const text = lastGenerateBody().text;
    expect(text).toMatch(/^Continue from the previous SYNTX thread/);
    expect(text).toContain("--- start of thread ---");
    expect(text.endsWith("Latest user message:\ngo on")).toBe(true);
  });

  it("isolated requests never reuse or remember a chat", async () => {
    const ex = executor();
    queueTurn([content("A"), "[DONE]"]);
    await run(ex, { body: userBody("Hi", { syntx_isolated: true }) });
    queueTurn([content("B"), "[DONE]"]);
    await run(ex, { body: { messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "A" }, { role: "user", content: "x" }] } });
    expect(createCalls()).toHaveLength(2);
    expect(JSON.parse(generateCalls()[0].body).tools).toEqual([]);
  });

  it("remembers only the pending first-turn key after a failed turn, so the follow-up joins that chat as in the source", async () => {
    const ex = executor();
    queueTurn([content("partial")]);
    const failed = await run(ex, { body: userBody("Hi") });
    expect(failed.response.status).toBe(502);
    queueTurn([content("A"), "[DONE]"]);
    await run(ex, { body: { messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "A" }, { role: "user", content: "next" }] } });
    // The source keeps the pending first-user key and the posted mark, so only the new turn is sent.
    expect(createCalls()).toHaveLength(1);
    expect(lastGenerateBody().text).toBe("next");
  });
});

// ── tools ────────────────────────────────────────────────────────────────────
const WEATHER_TOOL = { type: "function", function: { name: "get_weather", description: "Weather", parameters: { type: "object", properties: { city: { type: "string", description: "City" } }, required: ["city"] } } };

describe("tool framing (source syntxChat.ts)", () => {
  it("injects the tool catalog once, drops the client system, and parses <tool_call> into tool_calls", async () => {
    queueTurn([content('<tool_call>\n{"name": "get_weather", "arguments": {"city": "Paris"}}\n</tool_call>'), "[DONE]"]);
    const result = await run(executor(), { body: { tools: [WEATHER_TOOL], messages: [{ role: "system", content: "SYS-PROMPT" }, { role: "user", content: "Weather in Paris?" }] } });
    const text = lastGenerateBody().text;
    expect(text).toContain("# Tool Calling");
    expect(text).toContain("### get_weather\nWeather\nParameters:\n  - city (string, required) — City");
    expect(text).not.toContain("SYS-PROMPT");
    expect(text.endsWith("<user>\nWeather in Paris?\n</user>")).toBe(true);
    const body = await result.response.json();
    const call = body.choices[0].message.tool_calls[0];
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.choices[0].message.content).toBeNull();
    expect(call).toMatchObject({ type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } });
    expect(call.id).toMatch(/^call_[0-9a-f]{12}$/);
  });

  it("buffers a tool turn into SSE tool_calls deltas", async () => {
    queueTurn([content("<tool_call>"), content('{"name":"get_weather","arguments":{"city":"Rome"}}'), content("</tool_call>"), usageFinal(9, 3), "[DONE]"]);
    const result = await run(executor(), { stream: true, body: { tools: [WEATHER_TOOL], messages: [{ role: "user", content: "Rome?" }] } });
    const events = await sseEvents(result.response);
    expect(deltas(events)[1].tool_calls[0]).toMatchObject({ index: 0, function: { name: "get_weather", arguments: '{"city":"Rome"}' } });
    expect(finishes(events)).toEqual(["tool_calls"]);
  });

  it("sends only trailing tool results on the follow-up and does not re-inject the catalog", async () => {
    const ex = executor();
    queueTurn([content('<tool_call>{"name":"get_weather","arguments":{"city":"Paris"}}</tool_call>'), "[DONE]"]);
    const first = await (await run(ex, { body: { tools: [WEATHER_TOOL], messages: [{ role: "user", content: "Weather in Paris?" }] } })).response.json();
    const toolCall = first.choices[0].message.tool_calls[0];
    queueTurn([content("Sunny, 21C."), "[DONE]"]);
    const result = await run(ex, { body: { tools: [WEATHER_TOOL], messages: [
      { role: "user", content: "Weather in Paris?" },
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", tool_call_id: toolCall.id, name: "get_weather", content: "sunny, 21C" },
    ] } });
    expect(createCalls()).toHaveLength(1);
    expect(lastGenerateBody().text).toBe('<tool_result name="get_weather">\nsunny, 21C\n</tool_result>');
    expect((await result.response.json()).choices[0]).toMatchObject({ message: { content: "Sunny, 21C." }, finish_reason: "stop" });
  });

  it("parses fenced and alternate-key tool blocks and ignores malformed ones", () => {
    const parsed = parseSyntxToolCalls('Before <tool_call>```json\n{"tool":"a","args":{"x":1}}\n```</tool_call> <tool_call>{bad</tool_call> after');
    expect(parsed.calls.map((c) => [c.function.name, c.function.arguments])).toEqual([["a", '{"x":1}']]);
    expect(parsed.content).toBe("Before   after");
  });
});

// ── images and uploads ───────────────────────────────────────────────────────
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageBody = (url) => ({ messages: [{ role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url } }] }] });

describe("image uploads", () => {
  it("uploads a data URL as multipart and sends the returned r2 URL as files", async () => {
    queueTurn([content("A cat."), "[DONE]"]);
    await run(executor(), { body: imageBody(`data:image/png;base64,${PNG.toString("base64")}`) });
    expect(server.uploads).toHaveLength(1);
    const upload = server.uploads[0];
    expect(headerOf(upload.init, "content-type")).toMatch(/^multipart\/form-data; boundary=----WebKitFormBoundary[0-9a-f]{16}$/);
    const multipart = Buffer.from(upload.body).toString("latin1");
    expect(multipart).toContain('name="files"; filename="image.png"\r\nContent-Type: image/png');
    expect(multipart).toContain('name="destination"\r\n\r\nuploaded');
    expect(multipart).toContain('name="check_duplicates"\r\n\r\ntrue');
    expect(lastGenerateBody().files).toEqual([{ object_type: "image", object_url: "https://r2.syntx.ai/uploads/SYNTHETIC-1.png" }]);
  });

  it("downloads a public https image with no credentials, then uploads it", async () => {
    let seen;
    server.images["https://img.example.com/cat.png"] = (init) => {
      seen = init;
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    };
    queueTurn([content("A cat."), "[DONE]"]);
    await run(executor(), { body: imageBody("https://img.example.com/cat.png") });
    expect(headerOf(seen, "authorization")).toBeUndefined();
    expect(headerOf(seen, "cookie")).toBeUndefined();
    expect(seen.redirect).toBe("manual");
    expect(server.uploads).toHaveLength(1);
    expect(lastGenerateBody().files).toHaveLength(1);
  });

  it("never fetches a private, loopback-resolving, or non-https image URL, and re-checks redirects", async () => {
    server.images["https://hop.example.com/a.png"] = () => new Response(null, { status: 302, headers: { location: "https://evil.example.com/x.png" } });
    for (const url of ["https://127.0.0.1/a.png", "https://evil.example.com/a.png", "http://img.example.com/a.png", "https://hop.example.com/a.png", "https://unresolvable.example/a.png"]) {
      queueTurn([content("ok"), "[DONE]"]);
      const result = await run(executor(), { body: imageBody(url) });
      expect(result.response.status).toBe(200);
    }
    const fetched = calls.map((c) => c.url);
    expect(fetched).not.toContain("https://127.0.0.1/a.png");
    expect(fetched).not.toContain("https://evil.example.com/a.png");
    expect(fetched).not.toContain("https://evil.example.com/x.png");
    expect(fetched).not.toContain("http://img.example.com/a.png");
    expect(server.uploads).toHaveLength(0);
    expect(generateCalls().every((c) => !JSON.parse(c.body).files)).toBe(true);
  });

  it("passes an r2.syntx.ai image through and drops an upload answer that points off syntx.ai", async () => {
    queueTurn([content("ok"), "[DONE]"]);
    await run(executor(), { body: imageBody("https://r2.syntx.ai/uploads/existing.png") });
    expect(server.uploads).toHaveLength(0);
    expect(lastGenerateBody().files).toEqual([{ object_type: "image", object_url: "https://r2.syntx.ai/uploads/existing.png" }]);

    server.uploadResponse = () => json({ files: [{ url: "https://attacker.example/steal.png" }] });
    queueTurn([content("ok"), "[DONE]"]);
    await run(executor(), { body: imageBody(`data:image/png;base64,${PNG.toString("base64")}`) });
    expect(lastGenerateBody().files).toBeUndefined();
  });

  it("uploads a history file as text and fails closed with 422 when that upload fails", async () => {
    queueTurn([content("handoff"), "[DONE]"]);
    await run(executor(), { body: userBody("compact", { syntx_isolated: true, syntx_history_file: "transcript" }) });
    expect(server.uploads).toHaveLength(1);
    expect(Buffer.from(server.uploads[0].body).toString("utf8")).toContain('filename="tmp.txt"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\ntranscript');
    expect(lastGenerateBody().text).toMatch(/^Analyze the attached tmp\.txt/);

    server.uploadResponse = () => json({ detail: "no" }, 500);
    const before = generateCalls().length;
    const result = await run(executor(), { body: userBody("compact", { syntx_history_file: "transcript" }) });
    expect(result.response.status).toBe(422);
    expect(generateCalls()).toHaveLength(before);
  });
});

// ── failures: no replay, sanitized, quota ────────────────────────────────────
describe("failure contract", () => {
  it("maps a create-chat 401 to syntx_auth_error with no generate and no leak", async () => {
    server.createStatus = 401;
    const result = await run(executor());
    expect(result.response.status).toBe(401);
    await expectNoLeak(result);
    expect((await result.response.json()).error.code).toBe("syntx_auth_error");
    expect(generateCalls()).toHaveLength(0);
    expect(result.acceptedTurn).toBeUndefined();
  });

  it("maps generate 401/403 to 401 and 429 to 429 with Retry-After, sanitized and not replayed", async () => {
    server.generate.push({ status: 403 });
    let result = await run(executor());
    expect(result.response.status).toBe(401);
    expect(result.acceptedTurn).toBeUndefined();
    await expectNoLeak(result);

    server.generate.push({ status: 429, headers: { "retry-after": "30" } });
    result = await run(executor(), { body: userBody("again") });
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("retry-after")).toBe("30");
    const err = (await result.response.clone().json()).error;
    expect(err).toMatchObject({ code: "syntx_rate_limited", type: "rate_limit_error" });
    expect(err.message).toContain("[redacted]");
    await expectNoLeak(result);
    expect(generateCalls()).toHaveLength(2);
    expect(calls.some((c) => c.url.startsWith(SSE))).toBe(false);
  });

  it("marks a generate 5xx or transport error as uncertain and never re-posts", async () => {
    server.generate.push({ status: 502 });
    let result = await run(executor());
    expect(result.response.status).toBe(502);
    expect(result.acceptedTurn).toEqual({ state: "uncertain", outcome: "http-502" });

    server.generate.push({ throws: true });
    result = await run(executor(), { body: userBody("other") });
    expect(result.response.status).toBe(502);
    expect((await result.response.json()).error.code).toBe("syntx_generate_uncertain");
    expect(result.acceptedTurn).toEqual({ state: "uncertain", outcome: "transport-error" });
    expect(generateCalls()).toHaveLength(2);
  });

  it("refuses an off-origin stream_url without fetching it", async () => {
    server.generate.push({ stream_url: "https://attacker.example/stream/x" });
    const result = await run(executor());
    expect(result.response.status).toBe(502);
    expect((await result.response.json()).error.code).toBe("syntx_invalid_stream_url");
    expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "invalid-stream-url" });
    expect(calls.some((c) => c.url.startsWith("https://attacker.example"))).toBe(false);
  });

  it("reports an SSE error event, a truncated body and a non-200 stream as accepted failures", async () => {
    queueTurn([content("par"), { type: "error", message: `bad ${JWT_A}` }]);
    let result = await run(executor());
    expect(result.response.status).toBe(502);
    expect((await result.response.clone().json()).error.code).toBe("syntx_stream_error");
    expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "upstream-error" });
    await expectNoLeak(result);

    queueTurn([content("half")]);
    result = await run(executor(), { body: userBody("b") });
    expect((await result.response.json()).error.code).toBe("syntx_truncated");

    const url = queueTurn(null);
    server.streams[url] = () => new Response("gone", { status: 404 });
    result = await run(executor(), { body: userBody("c") });
    expect(result.response.status).toBe(502);
    expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "stream-http-404" });
    expect(generateCalls()).toHaveLength(3);
  });

  it("ends a live stream with finish_reason error when SYNTX fails after output", async () => {
    queueTurn([content("Hello "), { type: "error", message: "capacity" }]);
    const result = await run(executor(), { stream: true });
    expect(result.response.status).toBe(200);
    const events = await sseEvents(result.response);
    expect(deltas(events).slice(0, 2)).toEqual([{ role: "assistant" }, { content: "Hello " }]);
    expect(finishes(events)).toEqual(["error"]);
    expect(events.at(-1).error.code).toBe("syntx_stream_error");
  });

  it("fails a stalled stream before output with an HTTP error, bounded by the idle timer", async () => {
    queueTurn(": keepalive\n\n", { hang: true });
    const result = await run(executor({ idleTimeoutMs: 30 }), { stream: true });
    expect(result.response.status).toBe(504);
    expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "idle" });
  });

  it("bounds the stream size", async () => {
    const big = "x".repeat(2048);
    queueTurn([content(big), content(big), "[DONE]"]);
    const result = await run(executor({ maxStreamBytes: 1024 }));
    expect(result.response.status).toBe(502);
    expect(result.acceptedTurn.outcome).toBe("too-large");
  });

  it("throws an AbortError for a caller abort before any send", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run(executor(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual([]);
  });

  it("readSyntxSse needs [DONE] or usage_final to call a body complete", async () => {
    const read = (text) => readSyntxSse(new Response(text));
    expect((await read(sseText(content("a"), usageFinal(1, 1)))).outcome).toBe("complete");
    expect((await read(sseText(content("a"), "[DONE]"))).outcome).toBe("complete");
    expect((await read(sseText(content("a")))).outcome).toBe("truncated");
  });

  it("reads frames split across chunks, CRLF endings, a trailing unterminated frame, and one payload per data line", async () => {
    const wire = `data: {"type":"content","content":"Hel"}\r\n\r\ndata: {"type":"con` + `tent","content":"lo"}\ndata: {"type":"content","content":"!"}\n\n: ping\n\ndata: [DONE]`;
    const parts = [wire.slice(0, 17), wire.slice(17, 50), wire.slice(50)];
    const seen = [];
    const read = await readSyntxSse(new Response(streamOf(parts)), { onDelta: (d) => seen.push(d) });
    expect(read).toMatchObject({ outcome: "complete", text: "Hello!" });
    expect(seen).toEqual(["Hel", "lo!"]);
  });
});

// ── model discovery ──────────────────────────────────────────────────────────
describe("model discovery (source syntxModels.ts)", () => {
  it("keeps source numeric checks for usage and discovery without coercing strings", () => {
    expect(extractSyntxSseEvent(sseText(usageFinal("12", null))).usage).toEqual({
      prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
    });
    expect(extractSyntxSseEvent(sseText(usageFinal(0, 2))).usage).toEqual({
      prompt_tokens: 0, completion_tokens: 2, total_tokens: 2,
    });
    const [model] = parseSyntxModelsCatalog([{ id: "numeric-shape", context_window: "1000", default_max_tokens: null }]);
    expect(model.contextLength).toBeUndefined();
    expect(model.maxOutputTokens).toBeUndefined();
    const [zero] = parseSyntxModelsCatalog([{ id: "zero", context_window: 0, default_max_tokens: 0 }]);
    expect(zero.contextLength).toBe(0);
    expect(zero.maxOutputTokens).toBe(0);
  });

  it("parses the live catalog shape and caches per account", async () => {
    server.models = { models: [
      { id: "claude-x", label: "Claude X", ai_name: "claude", capabilities: { images: true, thinking: true }, context_window: 1000, default_max_tokens: 50 },
      { id: "claude-x" },
      { id: "mystery" },
      "junk",
    ] };
    const ex = executor();
    const models = await ex.discoverModels(credsA);
    expect(models).toEqual([
      { id: "claude-x", name: "Claude X", aiName: "claude", vision: true, thinking: true, contextLength: 1000, maxOutputTokens: 50 },
      { id: "mystery", name: "mystery", aiName: "chatgpt", vision: false, thinking: false, contextLength: undefined, maxOutputTokens: undefined },
    ]);
    const modelCall = calls.find((c) => c.url.includes("/api/v1/llm/models"));
    expect(modelCall.url).toBe(`${API}/api/v1/llm/models?enabled_only=true&lang=en`);
    expect(headerOf(modelCall.init, "authorization")).toBe(`Bearer ${JWT_A}`);
    expect(parseSyntxModelsCatalog([{ id: "bare" }])).toHaveLength(1);
  });

  it("falls back to the seed list when discovery fails, and rejects a non-JWT credential", async () => {
    const ex = executor();
    const map = await ex.catalog.catalogMap({ token: JWT_A, headers: {}, request: async () => ({ ok: false, status: 500 }) });
    expect(map.size).toBe(34);
    await expect(ex.discoverModels({ apiKey: "nope" })).rejects.toMatchObject({ status: 401 });
  });
});

// ── public API format translations ───────────────────────────────────────────
describe("Claude Messages and OpenAI Responses through the staged executor", () => {
  it("translates a Claude request and streams back Claude events", async () => {
    queueTurn([content("Bon"), content("jour"), usageFinal(7, 2), "[DONE]"]);
    const claudeBody = {
      model: "syntx/claude-sonnet-4-6", max_tokens: 256, system: "Answer in French.", stream: true,
      messages: [{ role: "user", content: [{ type: "text", text: "Say hi" }] }],
    };
    const openaiBody = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "syntx/claude-sonnet-4-6", claudeBody, true);
    const result = await run(executor(), { body: openaiBody, stream: true });
    expect(lastGenerateBody().text).toBe("<system>\nAnswer in French.\n</system>\n\n<user>\nSay hi\n</user>");
    expect(lastGenerateBody()).not.toHaveProperty("max_tokens");
    const events = translateStream(await sseEvents(result.response), FORMATS.CLAUDE);
    expect(events[0].type).toBe("message_start");
    expect(events.at(-1).type).toBe("message_stop");
    expect(events.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("")).toBe("Bonjour");
    expect(events.find((e) => e.type === "message_delta").delta.stop_reason).toBe("end_turn");
  });

  it("turns a prompted tool call into a Claude tool_use and carries the tool_result back", async () => {
    const ex = executor();
    const tools = [{ name: "get_weather", description: "Weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }];
    queueTurn([content('<tool_call>{"name":"get_weather","arguments":{"city":"Paris"}}</tool_call>'), "[DONE]"]);
    const claudeBody = { model: "syntx/claude-sonnet-4-6", max_tokens: 100, stream: true, tools, messages: [{ role: "user", content: "Weather in Paris?" }] };
    const result = await run(ex, { body: translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "syntx/claude-sonnet-4-6", claudeBody, true), stream: true });
    const events = translateStream(await sseEvents(result.response), FORMATS.CLAUDE);
    const toolUse = events.find((e) => e.type === "content_block_start" && e.content_block.type === "tool_use").content_block;
    expect(toolUse.name).toBe("get_weather");
    expect(events.filter((e) => e.delta?.type === "input_json_delta").map((e) => e.delta.partial_json).join("")).toBe('{"city":"Paris"}');
    expect(events.find((e) => e.type === "message_delta").delta.stop_reason).toBe("tool_use");

    queueTurn([content("Sunny."), "[DONE]"]);
    const follow = { model: "syntx/claude-sonnet-4-6", max_tokens: 100, tools, messages: [
      { role: "user", content: "Weather in Paris?" },
      { role: "assistant", content: [{ type: "tool_use", id: toolUse.id, name: "get_weather", input: { city: "Paris" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "sunny, 21C" }] },
    ] };
    const second = await run(ex, { body: translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "syntx/claude-sonnet-4-6", follow, false) });
    expect(createCalls()).toHaveLength(1);
    expect(lastGenerateBody().text).toMatch(/^<tool_result name="[^"]+">\nsunny, 21C\n<\/tool_result>$/);
    expect((await second.response.json()).choices[0].message.content).toBe("Sunny.");
  });

  it("translates a Responses request and streams back a completed response", async () => {
    queueTurn([content("Four"), usageFinal(5, 1), "[DONE]"]);
    const responsesBody = { model: "syntx/gpt-5.5", instructions: "Be terse.", input: [{ role: "user", content: [{ type: "input_text", text: "2+2?" }] }], stream: true };
    const openaiBody = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "syntx/gpt-5.5", responsesBody, true);
    const result = await run(executor(), { model: "syntx/gpt-5.5", body: openaiBody, stream: true });
    expect(generateCalls()[0].url).toBe(`${API}/api/v1/llm/generate?ai_name=chatgpt`);
    expect(lastGenerateBody().text).toBe("<system>\nBe terse.\n</system>\n\n<user>\n2+2?\n</user>");
    const events = translateStream(await sseEvents(result.response), FORMATS.OPENAI_RESPONSES);
    const names = events.map((e) => e.event);
    expect(names).toContain("response.output_text.delta");
    expect(names.filter((n) => /^response\.(completed|failed|incomplete)$/.test(n))).toEqual(["response.completed"]);
    expect(JSON.stringify(events.find((e) => e.event === "response.completed").data.response.output)).toContain("Four");
  });
});
