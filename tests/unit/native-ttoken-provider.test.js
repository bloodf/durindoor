// TTOken (#2034) contracts through production code with a mocked transport and synthetic keys.
// The staged definition is injected into the runtime maps; nothing here registers it.
// Upstream behaviour (wire bodies, error bodies) is synthetic: no live TTOken evidence exists.
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

// Captured before proxyFetch patches the global, for the loopback redirect checks.
const nativeFetch = vi.hoisted(() => globalThis.fetch);

vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

import { saveRequestUsage } from "@/lib/usageDb.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { normalizeModel } from "../../open-sse/providers/models/schema.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { TTOKEN_PROVIDER as staged, discoverTtokenModels } from "../../open-sse/services/providerParity/native-ttoken/index.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import { isAutoComboId } from "../../open-sse/services/autoComboResolver.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { clearLiveModelLimitsCache, resolveLiveOpenAIModels } from "../../open-sse/services/liveModelLimits.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { getProviderValidationGuard } from "../../open-sse/utils/outboundUrlGuard.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { isConnectionScopedSyncProvider } from "../../src/lib/modelAutoSync/connectionScope.js";

const CHAT = "https://api.ttoken.dev/v1/chat/completions";
const MODELS = "https://api.ttoken.dev/v1/models";
const KEY_A = "sk-ttoken-v1-synthetic-alpha";
const KEY_B = "sk-ttoken-v1-synthetic-beta";
const VISION_SEED = "deepseek/deepseek-v4.1-flash";
const PNG = "iVBORw0KGgo=";
const USAGE = { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 };
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// The transport register-native-19 must produce, including the probe quirk from the handoff.
const TRANSPORT = { ...staged.transport, format: "openai", authType: "apikey", quirks: { validationChatFallback: false } };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const sse = (chunks) => new Response(
  `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
  { headers: { "content-type": "text/event-stream" } },
);
const completion = (message = { role: "assistant", content: "hello" }, finish = "stop") =>
  ({ id: "chatcmpl-tt", object: "chat.completion", created: 1, model: "upstream", choices: [{ index: 0, message, finish_reason: finish }], usage: USAGE });
const chunk = (delta, finish = null) =>
  ({ id: "chatcmpl-tt", object: "chat.completion.chunk", created: 1, model: "upstream", choices: [{ index: 0, delta, finish_reason: finish }] });
const toolStream = () => sse([
  chunk({ role: "assistant", content: "Checking" }),
  chunk({ tool_calls: [{ index: 0, id: "call_tt", type: "function", function: { name: "weather", arguments: "" } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: "{\"city\":" } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: "\"Jakarta\"}" } }] }),
  chunk({}, "tool_calls"),
  { id: "chatcmpl-tt", object: "chat.completion.chunk", created: 1, model: "upstream", choices: [], usage: USAGE },
]);

const upstream = vi.fn();
const sent = (index = 0) => {
  const [url, init] = upstream.mock.calls[index];
  return { url: String(url), init, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : null };
};

async function chat(requested, body, { endpoint = "/v1/chat/completions", apiKey = KEY_A, ...extra } = {}) {
  const modelInfo = await getModelInfoCore(requested, {});
  const request = { ...body, model: requested };
  return handleChatCore({
    body: request, modelInfo, credentials: { apiKey, connectionId: "tt-a" }, connectionId: "tt-a", log,
    clientRawRequest: { endpoint, body: request, headers: {} },
    sourceFormatOverride: endpoint === "/v1/messages" ? FORMATS.CLAUDE : FORMATS.OPENAI,
    rtkEnabled: false, headroomEnabled: false, compressionEnabled: false, ...extra,
  });
}
const claude = (requested, body, extra) => chat(requested, { max_tokens: 64, ...body }, { endpoint: "/v1/messages", ...extra });
const hi = { messages: [{ role: "user", content: "hi" }] };
const events = (text) => text.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));

const previous = {};
let restoreFetch;
beforeAll(() => {
  const inject = (target, key, value) => {
    previous[key] ??= [];
    previous[key].push([target, Object.hasOwn(target, "ttoken"), target.ttoken]);
    target.ttoken = value;
  };
  inject(PROVIDERS, "runtime", TRANSPORT);
  inject(PROVIDER_MODELS, "models", staged.models.map(normalizeModel));
  inject(AI_PROVIDERS, "catalog", staged);
  restoreFetch = __setOriginalFetchForTesting(upstream);
});
afterAll(() => {
  restoreFetch();
  for (const entries of Object.values(previous)) {
    for (const [target, existed, value] of entries) {
      if (existed) target.ttoken = value;
      else delete target.ttoken;
    }
  }
});
beforeEach(() => {
  upstream.mockReset().mockImplementation(async (url) => { throw new Error(`unmocked upstream request: ${url}`); });
  vi.mocked(saveRequestUsage).mockClear();
  clearLiveModelLimitsCache();
});

describe("TTOken model ids", () => {
  it("runs on the existing DefaultExecutor", () => {
    expect(getExecutor("ttoken")).toBeInstanceOf(DefaultExecutor);
    expect(getExecutor("ttoken").constructor).toBe(DefaultExecutor);
  });

  it.each([
    ...staged.models.map(({ id }) => [`ttoken/${id}`, id]),
    ["ttoken/auto", "auto"],
    ["ttoken/vendor/family/unlisted-model", "vendor/family/unlisted-model"],
  ])("splits %s at the first slash and sends %s verbatim", async (requested, wire) => {
    upstream.mockResolvedValueOnce(json(completion()));
    expect((await chat(requested, hi)).success).toBe(true);
    expect(sent().body.model).toBe(wire);
  });

  // The source seeds the literal "ttoken/auto". Whether upstream wants that or "auto" is unverified,
  // so the router adds and strips nothing: each spelling reaches the wire as the client wrote it.
  it("needs the doubled prefix to send the literal source auto seed", async () => {
    expect(await getModelInfoCore("ttoken/ttoken/auto", {})).toEqual({ provider: "ttoken", model: "ttoken/auto" });
    expect(await getModelInfoCore("ttoken/auto", {})).toEqual({ provider: "ttoken", model: "auto" });
    expect(isAutoComboId("ttoken/auto")).toBe(false);
  });

  it("claims no existing prefix and leaves bare and vendor-prefixed routing alone", async () => {
    for (const entry of REGISTRY) {
      expect([entry.id, entry.alias, entry.uiAlias, ...(entry.aliases || [])]).not.toContain("ttoken");
    }
    expect(await getModelInfoCore("deepseek-v4.1-flash", {})).toEqual({ provider: "openrouter", model: "deepseek-v4.1-flash" });
    for (const { id } of staged.models.filter(({ id }) => !id.startsWith("ttoken/"))) {
      expect((await getModelInfoCore(id, {})).provider).not.toBe("ttoken");
    }
  });
});

describe("TTOken OpenAI clients", () => {
  const request = {
    messages: [
      { role: "user", content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }] },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "weather", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "rain" },
    ],
    tools: [{ type: "function", function: { name: "weather", description: "Weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }],
    tool_choice: "auto",
  };

  it("forwards tools and image blocks to the chat lane and records usage", async () => {
    upstream.mockResolvedValueOnce(json(completion({ role: "assistant", content: null, tool_calls: [{ id: "call_2", type: "function", function: { name: "weather", arguments: "{}" } }] }, "tool_calls")));
    const result = await chat(`ttoken/${VISION_SEED}`, request);
    const payload = await result.response.json();
    expect(sent().url).toBe(CHAT);
    expect(sent().headers.get("authorization")).toBe(`Bearer ${KEY_A}`);
    expect(sent().init).toMatchObject({ method: "POST", redirect: "error" });
    expect(sent().body).toMatchObject({ messages: request.messages, tools: request.tools, tool_choice: "auto", stream: false });
    expect(payload.choices[0]).toMatchObject({ finish_reason: "tool_calls", message: { tool_calls: [{ id: "call_2" }] } });
    expect(payload.usage.completion_tokens).toBe(USAGE.completion_tokens);
    expect(vi.mocked(saveRequestUsage).mock.calls[0][0]).toMatchObject({ provider: "ttoken", model: VISION_SEED, tokens: { prompt_tokens: 11, completion_tokens: 3 } });
  });

  it("streams text and tool-call deltas and records the upstream usage chunk", async () => {
    upstream.mockResolvedValueOnce(toolStream());
    const result = await chat(`ttoken/${VISION_SEED}`, { ...request, stream: true, stream_options: { include_usage: true } });
    const rows = events(await result.response.text());
    expect(sent().url).toBe(CHAT);
    expect(sent().body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    const deltas = rows.flatMap((row) => row.choices?.[0]?.delta?.tool_calls ?? []);
    expect(deltas.map((delta) => delta.function?.arguments ?? "").join("")).toBe("{\"city\":\"Jakarta\"}");
    expect(rows.some((row) => row.choices?.[0]?.finish_reason === "tool_calls")).toBe(true);
    await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalled());
    expect(vi.mocked(saveRequestUsage).mock.calls[0][0].tokens.completion_tokens).toBe(USAGE.completion_tokens);
  });

  // No capability metadata is declared for ids outside the name tables, so the shared
  // modality guard replaces their images. The handoff keeps that a registration decision.
  it.each(["ttoken/ttoken/auto", "ttoken/vendor/unlisted-model"])("does not claim image input for %s", async (requested) => {
    upstream.mockResolvedValueOnce(json(completion()));
    await chat(requested, request);
    expect(JSON.stringify(sent().body.messages)).not.toContain(PNG);
    expect(sent().body.tools).toHaveLength(1);
  });
});

describe("TTOken Anthropic clients", () => {
  const request = {
    system: "Be brief.",
    messages: [
      { role: "user", content: [{ type: "text", text: "see" }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }] },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "weather", input: { city: "Jakarta" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "rain" }] },
    ],
    tools: [{ name: "weather", description: "Weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
  };

  it("translates to the OpenAI chat lane, never native messages, and back", async () => {
    upstream.mockResolvedValueOnce(json(completion({ role: "assistant", content: null, tool_calls: [{ id: "call_2", type: "function", function: { name: "weather", arguments: "{\"city\":\"Bogor\"}" } }] }, "tool_calls")));
    const result = await claude(`ttoken/${VISION_SEED}`, request);
    const payload = await result.response.json();
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(sent().url).toBe(CHAT);
    const { messages, tools } = sent().body;
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(JSON.stringify(messages[1])).toContain(`data:image/png;base64,${PNG}`);
    expect(messages.find((message) => message.tool_calls)?.tool_calls[0]).toMatchObject({ id: "toolu_1", function: { name: "weather" } });
    expect(messages.find((message) => message.role === "tool")).toMatchObject({ tool_call_id: "toolu_1", content: "rain" });
    expect(tools[0]).toMatchObject({ type: "function", function: { name: "weather", parameters: { type: "object" } } });
    expect(payload).toMatchObject({ type: "message", stop_reason: "tool_use", usage: { input_tokens: 11, output_tokens: 3 } });
    expect(payload.content.find((block) => block.type === "tool_use")).toMatchObject({ name: "weather", input: { city: "Bogor" } });
  });

  it("streams OpenAI deltas as Anthropic events with tool input and usage", async () => {
    upstream.mockResolvedValueOnce(toolStream());
    const result = await claude(`ttoken/${VISION_SEED}`, { ...request, stream: true });
    const rows = events(await result.response.text());
    expect(sent().url).toBe(CHAT);
    expect(sent().body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(rows[0].type).toBe("message_start");
    expect(rows.at(-1).type).toBe("message_stop");
    expect(rows.some((row) => row.content_block?.type === "tool_use" && row.content_block.name === "weather")).toBe(true);
    expect(rows.map((row) => row.delta?.partial_json ?? "").join("")).toBe("{\"city\":\"Jakarta\"}");
    const closing = rows.find((row) => row.type === "message_delta");
    expect(closing.delta.stop_reason).toBe("tool_use");
    expect(closing.usage.output_tokens).toBe(USAGE.completion_tokens);
    await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalled());
  });
});

describe("TTOken upstream errors", () => {
  it.each([
    [401, "authentication_error"],
    [403, "permission_error"],
    [429, "rate_limit_error"],
    [500, "server_error"],
    [503, "server_error"],
  ])("preserves %i for OpenAI and Anthropic clients", async (status, type) => {
    for (const send of [chat, claude]) {
      upstream.mockResolvedValueOnce(json({ error: { message: "synthetic refusal" } }, status));
      const result = await send(`ttoken/${VISION_SEED}`, hi, { accountFailoverAvailable: true });
      expect(result).toMatchObject({ success: false, status });
      const payload = await result.response.json();
      expect(payload.error.type).toBe(send === claude && status >= 500 ? (status === 503 ? "overloaded_error" : "api_error") : type);
      expect(JSON.stringify(payload)).not.toContain("insufficient_quota");
    }
  });

  it("keeps a wrong-product 403 apart from an exhausted quota", async () => {
    const wrongProduct = "This key belongs to a different product";
    upstream.mockResolvedValueOnce(json({ error: { message: wrongProduct } }, 403));
    const result = await chat(`ttoken/${VISION_SEED}`, hi);
    expect(result.rateLimitEvidence).toBeFalsy();
    const refused = checkFallbackError(403, wrongProduct, 0, "ttoken");
    expect(refused.rateLimitEvidence).toBeUndefined();
    expect(refused.terminal).toBeUndefined();
    expect(refused.newBackoffLevel).toBeUndefined();
    // A quota-worded 429 takes the escalating rate-limit path instead.
    expect(checkFallbackError(429, "quota exceeded", 0, "ttoken").newBackoffLevel).toBe(1);
  });

  it("does not echo the key back from an upstream error", async () => {
    upstream.mockResolvedValueOnce(json({ error: { message: `bad key ${KEY_A}` } }, 401));
    const result = await chat(`ttoken/${VISION_SEED}`, hi);
    expect(await result.response.text()).not.toContain(KEY_A);
    expect(result.error).not.toContain(KEY_A);
  });
});

describe("TTOken cancellation", () => {
  it("aborts the pending upstream request when the client leaves", async () => {
    const client = new AbortController();
    let upstreamSignal;
    upstream.mockImplementation((url, init) => new Promise((resolve, reject) => {
      upstreamSignal = init.signal;
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    const pending = chat(`ttoken/${VISION_SEED}`, hi, { abortSignal: client.signal });
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
    client.abort();
    await expect(pending).resolves.toMatchObject({ success: false, status: 499 });
    expect(upstreamSignal.aborted).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("releases the upstream stream when the client stops reading", async () => {
    const cancel = vi.fn();
    upstream.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk({ content: "a" }))}\n\n`)); },
      cancel,
    }), { headers: { "content-type": "text/event-stream" } }));
    const result = await chat(`ttoken/${VISION_SEED}`, { ...hi, stream: true });
    const reader = result.response.body.getReader();
    await reader.read();
    await reader.cancel("client left");
    await vi.waitFor(() => expect(cancel.mock.calls.length > 0 || sent().init.signal.aborted).toBe(true), { timeout: 10_000 });
  });
});

// A loopback server stands in for the origin so the platform fetch applies the redirect mode.
describe("TTOken redirects", () => {
  let server;
  let origin;
  const hits = [];
  beforeAll(async () => {
    server = createServer((request, response) => {
      hits.push(request.url);
      if (request.url === "/elsewhere") { response.end("{\"data\":[]}"); return; }
      response.writeHead(307, { location: "/elsewhere" }).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(() => {
    hits.length = 0;
    upstream.mockImplementation((url, { dispatcher, proxyOptions, ...init }) => nativeFetch(`${origin}${new URL(url).pathname}`, init));
  });

  it("never follows a redirect with the key on the chat lane", async () => {
    const result = await chat(`ttoken/${VISION_SEED}`, hi, { accountFailoverAvailable: true });
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits)).toEqual(new Set(["/v1/chat/completions"]));
  }, 30_000);

  it("never follows a redirect during key-scoped discovery", async () => {
    expect(await discoverTtokenModels({ id: "a", apiKey: KEY_A })).toEqual({ error: "TTOken model discovery refused a redirect", status: 502 });
    expect(hits).toEqual(["/v1/models"]);
  });
});

describe("TTOken staged key-scoped discovery", () => {
  const catalogs = { [`Bearer ${KEY_A}`]: [{ id: "ttoken/auto" }, { id: "vendor/a-only" }], [`Bearer ${KEY_B}`]: [{ id: "vendor/b-only" }] };
  const perKey = async (url, init) => json({ data: catalogs[new Headers(init.headers).get("authorization")] });

  it("asks upstream every time and never shares a list between keys", async () => {
    upstream.mockImplementation(perKey);
    const a = await discoverTtokenModels({ id: "a", apiKey: KEY_A });
    const b = await discoverTtokenModels({ id: "b", apiKey: KEY_B });
    const again = await discoverTtokenModels({ id: "a", apiKey: KEY_A });
    expect(a).toEqual({ provider: "ttoken", connectionId: "a", source: "provider_api", models: catalogs[`Bearer ${KEY_A}`] });
    expect(b.models).toEqual(catalogs[`Bearer ${KEY_B}`]);
    expect(again.models).toEqual(a.models);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(sent().url).toBe(MODELS);
    expect(sent().init).toMatchObject({ method: "GET", cache: "no-store", redirect: "manual" });
  });

  it("passes the connection's proxy route to its transport", async () => {
    const fetchImpl = vi.fn(async () => json({ data: [] }));
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" };
    expect(await discoverTtokenModels({ id: "a", apiKey: KEY_A }, { proxyOptions, fetchImpl })).toMatchObject({ models: [] });
    expect(fetchImpl.mock.calls[0][2]).toBe(proxyOptions);
  });

  it.each([401, 403, 429, 500, 502, 503])("keeps %i, relays no body and returns no seed list", async (status) => {
    upstream.mockResolvedValueOnce(json({ error: { message: `private detail ${KEY_A}` } }, status));
    const result = await discoverTtokenModels({ id: "a", apiKey: KEY_A });
    expect(result.status).toBe(status);
    expect(result.models).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("private detail");
    expect(result.error).not.toMatch(/quota/i);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("rejects an unreadable list and an unreachable host", async () => {
    upstream.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    expect(await discoverTtokenModels({ apiKey: KEY_A })).toMatchObject({ status: 502, error: "TTOken returned an invalid model list" });
    upstream.mockResolvedValueOnce(json({ models: [] }));
    expect(await discoverTtokenModels({ apiKey: KEY_A })).toMatchObject({ status: 502, error: "TTOken returned an invalid model list" });
    upstream.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await discoverTtokenModels({ apiKey: KEY_A })).toMatchObject({ status: 502, error: "TTOken model discovery is unreachable" });
  });

  it("sends nothing without a key or after the caller has cancelled", async () => {
    expect(await discoverTtokenModels({ id: "a" })).toMatchObject({ status: 401 });
    expect(await discoverTtokenModels({ apiKey: KEY_A }, { signal: AbortSignal.abort() })).toMatchObject({ status: 499 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("honours caller cancellation and its own deadline while waiting", async () => {
    upstream.mockImplementation((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    const client = new AbortController();
    const pending = discoverTtokenModels({ apiKey: KEY_A }, { signal: client.signal });
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    client.abort();
    await expect(pending).resolves.toMatchObject({ status: 499 });
    expect(sent().init.signal.aborted).toBe(true);

    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    const slow = discoverTtokenModels({ apiKey: KEY_A });
    expect(timeout).toHaveBeenCalledWith(8000);
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(2));
    deadline.abort(new DOMException("deadline", "TimeoutError"));
    await expect(slow).resolves.toMatchObject({ status: 504 });
    timeout.mockRestore();
  });
});

describe("TTOken existing shared lanes after injection", () => {
  it.each([[200, true], [401, false], [403, false], [429, false], [302, false]])(
    "validates a key only against the authenticated model list (%i)",
    async (status, valid) => {
      const fetcher = vi.fn(async () => new Response(status === 302 ? null : "{\"data\":[]}", { status }));
      expect(await probeRegistryProvider("ttoken", KEY_A, fetcher)).toMatchObject({ valid, status });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe(MODELS);
      expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual", headers: { Authorization: `Bearer ${KEY_A}` } });
    },
  );

  it("reports a 5xx validation as unavailable rather than a bad key", async () => {
    const fetcher = vi.fn(async () => json({}, 503));
    expect(await probeRegistryProvider("ttoken", KEY_A, fetcher)).toMatchObject({ valid: false, unavailable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("would send a billable chat probe on 429 without the required quirk", async () => {
    const { quirks, ...withoutQuirk } = TRANSPORT;
    PROVIDERS.ttoken = withoutQuirk;
    try {
      const fetcher = vi.fn(async () => json({}, 429));
      await probeRegistryProvider("ttoken", KEY_A, fetcher);
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([MODELS, CHAT]);
    } finally {
      PROVIDERS.ttoken = TRANSPORT;
    }
  });

  it("keeps the public model-list lane per key, manual-redirect and no-store", async () => {
    upstream.mockImplementation(async (url, init) => json({ data: [{ id: new Headers(init.headers).get("authorization").endsWith("alpha") ? "vendor/a-only" : "vendor/b-only" }] }));
    const list = (id, apiKey) => resolveLiveOpenAIModels({ id, apiKey }, { provider: "ttoken", endpoint: MODELS, guard: getProviderValidationGuard() });
    expect((await list("a", KEY_A)).models).toEqual([{ id: "vendor/a-only" }]);
    expect((await list("b", KEY_B)).models).toEqual([{ id: "vendor/b-only" }]);
    expect((await list("a", KEY_A)).models).toEqual([{ id: "vendor/a-only" }]);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(sent().init).toMatchObject({ redirect: "manual", cache: "no-store" });
  });

  it("keeps connection model lists separate and preserves discovery statuses", async () => {
    upstream.mockResolvedValueOnce(json({ data: [{ id: "vendor/a-only" }] })).mockResolvedValueOnce(json({ data: [{ id: "vendor/b-only" }] }));
    expect((await fetchConnectionModels({ id: "a", provider: "ttoken", apiKey: KEY_A })).models).toEqual([{ id: "vendor/a-only" }]);
    expect((await fetchConnectionModels({ id: "b", provider: "ttoken", apiKey: KEY_B })).models).toEqual([{ id: "vendor/b-only" }]);
    expect(sent(1).headers.get("authorization")).toBe(`Bearer ${KEY_B}`);
    for (const status of [401, 403, 429, 503]) {
      upstream.mockResolvedValueOnce(json({ error: "synthetic" }, status));
      expect(await fetchConnectionModels({ id: "a", provider: "ttoken", apiKey: KEY_A })).toMatchObject({ status });
    }
  });
});

// register-native-19: these describe today's gaps. Replace each with its positive form
// when the matching prerequisite in the handoff lands.
describe("TTOken staging-only state", () => {
  it("is not registered", () => {
    expect(REGISTRY.some((entry) => entry.id === "ttoken")).toBe(false);
  });

  it("still uses the generic discovery that ignores cancellation and sets no redirect mode", async () => {
    upstream.mockResolvedValueOnce(json({ data: [] }));
    const result = await fetchConnectionModels({ id: "a", provider: "ttoken", apiKey: KEY_A }, { signal: AbortSignal.abort() });
    expect(result.models).toEqual([]);
    expect(sent().init.redirect).toBeUndefined();
    expect(sent().init.cache).toBeUndefined();
    expect(sent().init.signal.aborted).toBe(false);
  });

  it("is not yet connection-scoped for synced catalogs", () => {
    expect(isConnectionScopedSyncProvider("ttoken")).toBe(false);
  });
});
