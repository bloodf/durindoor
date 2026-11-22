/**
 * Registration batch B (#2034), route level. Every provider the batch registers with a working executor
 * is driven through the real `/v1/chat/completions` and `/v1/messages` route modules (JSON and streamed),
 * against the production registry, executor map and a temporary SQLite store.
 *
 * Closed mocks only: the upstream site is a scripted global `fetch` (or, for Arena, a scripted TLS
 * client; for Cloudflare Playground, a scripted transport in place of the browser). Credentials are
 * synthetic placeholders. Nothing here reaches a provider, a browser or the network, and a request to a
 * host outside the provider's own origins fails the test.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", async (importOriginal) => ({
  ...(await importOriginal()),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  finishPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

// Arena speaks through a browser-TLS client; the test replaces it with a scripted reply.
const arena = vi.hoisted(() => ({ calls: [], answer: "" }));
vi.mock("../../open-sse/services/lmarenaTlsClient.js", () => ({
  tlsFetchLMArena: vi.fn(async (url, options) => {
    arena.calls.push({ url: String(url), options });
    return { status: 200, text: `data: ${JSON.stringify({ text: arena.answer })}\n\n` };
  }),
}));

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const eventStream = (text) => new Response(text, { headers: { "Content-Type": "text/event-stream" } });
const sse = (...frames) => `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
const wantsStream = (init) => JSON.parse(init.body).stream === true;

/** OpenAI Chat Completions reply, JSON or streamed according to the request. */
const openAiReply = (init, answer) => (wantsStream(init)
  ? eventStream(sse(
    { id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: { role: "assistant", content: answer }, finish_reason: null }] },
    { id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ))
  : jsonResponse({
    id: "c1", object: "chat.completion", model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  }));

/** Anthropic Messages reply, JSON or streamed according to the request. */
const claudeReply = (init, answer) => {
  if (!wantsStream(init)) {
    return jsonResponse({
      id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: answer }], usage: { input_tokens: 3, output_tokens: 2 },
    });
  }
  const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  return eventStream([
    event("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], usage: { input_tokens: 3, output_tokens: 0 } } }),
    event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: answer } }),
    event("content_block_stop", { type: "content_block_stop", index: 0 }),
    event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }),
    event("message_stop", { type: "message_stop" }),
  ].join(""));
};

const jwt = (payload) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
const SIGNING = { hmacKey: "a".repeat(40), aesKey: "b".repeat(40), appVersion: "webpage_1.0.0", ctxKey: "c".repeat(40) };

const g4f = (id, host, model, answer) => ({
  id, model, answer, credential: `synthetic-${id}-key`, origins: ["https://g4f.space"],
  handle: (url, init) => (url === `https://g4f.space/api/${host}/v1/chat/completions` ? openAiReply(init, answer) : undefined),
});

/**
 * One scripted upstream per provider. `origins` are the only hosts the provider may contact; `handle`
 * answers the site's own requests and returns undefined for anything unexpected.
 */
const PROVIDERS = [
  { id: "twinmind", model: "auto", answer: "pong from twinmind", credential: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }), origins: ["https://api2.twinmind.com"], handle: (url) => url === "https://api2.twinmind.com/api/v3/chat" ? eventStream(sse({ type: "text_delta", content: "pong from twinmind" })) : undefined },
  {
    id: "helyxai", model: "openai/gpt-4o", answer: "pong from helyx", credential: "synthetic-helyx-key", origins: ["https://helyxai.space"],
    handle: (url, init) => (url === "https://helyxai.space/v1/chat/completions/" ? openAiReply(init, "pong from helyx") : undefined),
  },
  {
    id: "tabitoken", claudeUpstream: true, model: "claude-opus-5", answer: "pong from tabitoken", credential: "synthetic-tabitoken-key", origins: ["https://tabitoken.com"],
    handle: (url, init) => {
      if (url !== "https://tabitoken.com/v1/messages") return undefined;
      expect(new Headers(init.headers).get("x-api-key")).toBe("synthetic-tabitoken-key");
      return claudeReply(init, "pong from tabitoken");
    },
  },
  {
    id: "poe", label: "poe (chat completions)", model: "gpt-5.2", answer: "pong from poe", credential: "synthetic-poe-key", origins: ["https://api.poe.com"],
    handle: (url, init) => (url === "https://api.poe.com/v1/chat/completions" ? openAiReply(init, "pong from poe") : undefined),
  },
  {
    id: "poe", label: "poe (Claude bot over /v1/messages)", claudeUpstream: true, model: "claude-opus-4.8", answer: "pong from poe claude", credential: "synthetic-poe-key", origins: ["https://api.poe.com"],
    handle: (url, init) => (url === "https://api.poe.com/v1/messages" ? claudeReply(init, "pong from poe claude") : undefined),
  },
  g4f("g4f-gemini", "gemini", "models/gemini-2.5-flash", "pong from g4f gemini"),
  g4f("g4f-nvidia", "nvidia", "nvidia/nemotron-3-nano-30b-a3b", "pong from g4f nvidia"),
  g4f("g4f-ollama", "ollama", "gemma3:4b", "pong from g4f ollama"),
  g4f("g4f-pollinations", "pollinations", "openai", "pong from g4f pollinations"),
  {
    id: "maxai", model: "gpt-5.6-luna", answer: "pong from maxai", origins: ["https://api.maxai.me"],
    credential: `access_token=${jwt({ sub: "user-synthetic" })}; device_id=device-synthetic; user_id=user-synthetic`,
    providerSpecificData: { maxaiSigningConstants: SIGNING },
    handle: (url, init) => {
      if (url !== "https://api.maxai.me/gpt/cwc/chat") return undefined;
      expect(new Headers(init.headers).get("authorization")).toMatch(/^Bearer eyJ/);
      return eventStream(`data: ${JSON.stringify({ text: "pong from maxai" })}\n\n`);
    },
  },
  {
    id: "lmarena", model: "claude-sonnet-5", answer: "pong from arena", origins: [], tls: true,
    credential: "arena-auth-prod-v1=synthetic-arena-session",
    handle: () => undefined,
  },
  {
    id: "chatplayground", model: "gpt-4o", answer: "pong from chatplayground",
    credential: `__client=synthetic-client; __session=${jwt({ sid: "sess_synthetic" })}`,
    origins: ["https://app.chatplayground.ai", "https://clerk.chatplayground.ai"],
    handle: (url, init) => {
      if (url.startsWith("https://clerk.chatplayground.ai/v1/client/sessions/sess_synthetic/tokens")) return jsonResponse({ jwt: jwt({ sid: "sess_synthetic", minted: true }) });
      if (url === "https://app.chatplayground.ai/api/user") return jsonResponse({ id: "user-synthetic" });
      if (url === "https://app.chatplayground.ai/api/models") {
        return jsonResponse({ data: [{ botId: "gpt-4o", displayName: "GPT-4o", modelName: "gpt-4o", provider: "openai", endpoint: "azure", group: "chat" }] });
      }
      if (url === "https://app.chatplayground.ai/api/chat/azure") return new Response("pong from chatplayground", { headers: { "Content-Type": "text/plain" } });
      return undefined;
    },
  },
  {
    id: "cloudflare-playground", model: "zai-org/glm-4.7-flash", answer: "pong from cloudflare playground", origins: [], transport: true,
    credential: null,
    handle: () => undefined,
  },
];

let root;
let routes;
let seen;
let cloudflare;
let handler = null;

const gatewayRequest = (url, body) => new Request(`http://gateway.invalid${url}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "apikey-batch-b-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  seen = [];
  arena.calls = [];
  handler = null;
  // One stable dispatcher installed before any module loads: some executors keep the `fetch` they saw
  // when they were constructed, so the scripted upstream is chosen per test through `handler`.
  vi.stubGlobal("fetch", async (input, init = {}) => {
    const url = String(input);
    seen.push(url);
    if (!handler) throw new Error(`closed mock: unexpected request ${url}`);
    if (!handler.origins.some((origin) => url.startsWith(origin))) throw new Error(`closed mock: unexpected host ${url}`);
    const reply = handler.handle(url, init);
    if (!reply) throw new Error(`closed mock: unexpected request ${url}`);
    return reply;
  });
  routes = {
    providers: await import("../../src/app/api/providers/route.js"),
    chat: await import("../../src/app/api/v1/chat/completions/route.js"),
    messages: await import("../../src/app/api/v1/messages/route.js"),
  };
  cloudflare = await import("../../open-sse/executors/cloudflare-playground.js");
}, 60000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

/** Save the provider's connection through the providers route. */
async function saveConnection(provider, credential) {
  const saved = await routes.providers.POST(gatewayRequest("/api/providers", {
    provider: provider.id, name: `${provider.id}-synthetic`, ...(credential ? { apiKey: credential } : null),
    ...(provider.providerSpecificData ? { providerSpecificData: provider.providerSpecificData } : null),
  }));
  expect(saved.status).toBe(201);
  const { connection } = await saved.json();
  expect(connection.provider).toBe(provider.id);
}

/** Install the scripted upstream for one provider and save its connection. */
async function arm(provider) {
  handler = provider;
  arena.answer = provider.answer;
  if (provider.transport) {
    // The Playground transport drives a browser; replace it with scripted frames.
    vi.spyOn(cloudflare.PlaywrightCloudflareTransport.prototype, "start").mockResolvedValue({ ok: true });
    vi.spyOn(cloudflare.PlaywrightCloudflareTransport.prototype, "close").mockResolvedValue(undefined);
    vi.spyOn(cloudflare.PlaywrightCloudflareTransport.prototype, "frames").mockImplementation(async function* frames() {
      const frame = (body, extra = {}) => JSON.stringify({ id: this.chatId, type: "cf_agent_use_chat_response", body: JSON.stringify(body), ...extra });
      yield frame({ type: "text-delta", delta: provider.answer });
      yield frame({}, { done: true });
    });
  }
  await saveConnection(provider, provider.credential);
}

const openAiBody = (provider, stream) => ({
  model: `${provider.id}/${provider.model}`, stream, messages: [{ role: "user", content: "ping" }],
});
const anthropicBody = (provider, stream) => ({
  model: `${provider.id}/${provider.model}`, max_tokens: 64, stream, messages: [{ role: "user", content: "ping" }],
});

describe.each(PROVIDERS.map((provider) => ({ ...provider, title: provider.label ?? provider.id })))("route-level chat for $title (closed mock)", (provider) => {
  beforeEach(async () => { await arm(provider); });

  const reachedOnlyItsOwnOrigin = () => {
    // The scripted upstream was really reached: by fetch, by the TLS client or by the scripted transport.
    if (provider.tls) expect(arena.calls.length).toBeGreaterThan(0);
    else if (provider.transport) expect(cloudflare.PlaywrightCloudflareTransport.prototype.start).toHaveBeenCalled();
    else expect(seen.length).toBeGreaterThan(0);
    for (const url of seen) expect(provider.origins.some((origin) => url.startsWith(origin)), url).toBe(true);
    for (const call of arena.calls) expect(call.url.startsWith("https://arena.ai/")).toBe(true);
  };

  it("answers /v1/chat/completions as JSON", async () => {
    const response = await routes.chat.POST(gatewayRequest("/v1/chat/completions", openAiBody(provider, false)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toContain(provider.answer);
    expect(body.choices[0].finish_reason).toBeTruthy();
    reachedOnlyItsOwnOrigin();
  });

  it("answers /v1/chat/completions as a stream", async () => {
    const response = await routes.chat.POST(gatewayRequest("/v1/chat/completions", openAiBody(provider, true)));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    const streamed = text.split("\n").filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return {}; } })
      .map((chunk) => chunk.choices?.[0]?.delta?.content ?? "").join("");
    expect(streamed).toContain(provider.answer);
    // A Claude-format upstream is translated to OpenAI chunks that end on the finish chunk, with no [DONE] marker.
    if (provider.claudeUpstream) expect(text).toContain('"finish_reason":"stop"');
    else expect(text).toContain("data: [DONE]");
    reachedOnlyItsOwnOrigin();
  });

  it("answers /v1/messages as JSON", async () => {
    const response = await routes.messages.POST(gatewayRequest("/v1/messages", anthropicBody(provider, false)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.content.map((block) => block.text ?? "").join("")).toContain(provider.answer);
    reachedOnlyItsOwnOrigin();
  });

  it("answers /v1/messages as a stream", async () => {
    const response = await routes.messages.POST(gatewayRequest("/v1/messages", anthropicBody(provider, true)));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("event: message_stop");
    const streamed = text.split("\n").filter((line) => line.startsWith("data: "))
      .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return {}; } })
      .filter((event) => event.type === "content_block_delta").map((event) => event.delta?.text ?? "").join("");
    expect(streamed).toContain(provider.answer);
    reachedOnlyItsOwnOrigin();
  });
});
