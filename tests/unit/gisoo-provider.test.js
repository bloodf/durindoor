// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { getProviderErrorRuleMatch } from "../../open-sse/config/providerErrorRules.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { addBufferToUsage } from "../../open-sse/utils/usageTracking.js";
import { GISOO_MODELS_URL, parseGisooModels } from "../../open-sse/providers/gisooCatalog.js";
import { PROVIDER_MODELS_CONFIG } from "../../src/app/api/providers/[id]/models/modelsConfig.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";

/**
 * Gisoo (gisoo.pro) provider.
 *
 * Every request in this file is served by a local mock: the upstream host is
 * never resolved and no credential is real. The synthetic keys below are
 * fixtures, not Gisoo credentials.
 */
const SYNTHETIC_KEY = "sk-gisoo-v1-synthetic-0000000000000001";
const SYNTHETIC_KEY_SECOND = "sk-gisoo-v1-synthetic-0000000000000002";
const CHAT_PATH = "/api/v1/chat/completions";
const CATALOG_PATH = "/api/v1/models";
const ACCOUNT_PATH = "/api/v1/me";

const catalogRows = [
  {
    id: "gpt-5.6-sol",
    object: "model",
    name: "GPT-5.6 Sol",
    type: "chat",
    context_length: 1050000,
    max_output_tokens: 128000,
    capabilities: { streaming: true, tools: true, json: true, vision: true, reasoning: true },
    is_free: false,
    pricing: { input_per_million: "5.600000", output_per_million: "28.000000" },
  },
  {
    id: "claude-opus-5-5",
    object: "model",
    name: "Claude Opus 5.5",
    type: "chat",
    context_length: 1000000,
    max_output_tokens: 128000,
    capabilities: { streaming: true, tools: true, json: true, vision: true, reasoning: true },
    is_free: false,
    pricing: { input_per_million: "5.600000", output_per_million: "28.000000" },
  },
  {
    id: "openrouter/anthropic/claude-sonnet-4.5",
    object: "model",
    name: "Claude Sonnet 4.5",
    type: "chat",
    context_length: 200000,
    max_output_tokens: 64000,
    capabilities: { streaming: true, tools: true, json: true, vision: false, reasoning: true },
    is_free: false,
  },
  {
    id: "sora-2",
    object: "model",
    name: "Sora 2",
    type: "video",
    context_length: 0,
    max_output_tokens: 0,
    capabilities: { streaming: false, tools: false, json: false, vision: true, reasoning: false },
    is_free: false,
  },
];

const chatUsage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };

function catalogResponse() {
  return Response.json({ object: "list", data: catalogRows });
}

function chatResponse({ stream = false, content = "gisoo reply" } = {}) {
  const common = { id: "chatcmpl-gisoo", object: "chat.completion", created: 1, model: "gpt-5.6-sol" };
  if (!stream) {
    return Response.json({
      ...common,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: chatUsage,
    });
  }
  const chunks = [
    { choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: chatUsage },
  ].map((chunk) => `data: ${JSON.stringify({ ...common, object: "chat.completion.chunk", ...chunk })}\n\n`);
  return new Response(chunks.join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}

function upstreamError(status, code, message) {
  return Response.json({ error: { message, type: "invalid_request_error", code, param: null } }, { status });
}

describe("Gisoo provider registration", () => {
  const gisoo = REGISTRY.find((entry) => entry.id === "gisoo");

  it("registers an API-key OpenAI-compatible transport", () => {
    expect(gisoo).toBeDefined();
    expect(gisoo.category).toBe("apikey");
    expect(gisoo.authType).toBe("apikey");
    expect(gisoo.authModes).toEqual(["apikey"]);
    expect(PROVIDERS.gisoo).toMatchObject({
      baseUrl: "https://gisoo.pro/api/v1/chat/completions",
      format: "openai",
    });
    expect(resolveProviderAlias("gisoo")).toBe("gisoo");
  });

  it("validates the credential against the authenticated account endpoint, not the public catalog", () => {
    // GET /api/v1/models answers 200 without a key and even with an invalid
    // one, so it cannot prove a credential. GET /api/v1/me answers 401.
    expect(PROVIDERS.gisoo.validateUrl).toBe("https://gisoo.pro/api/v1/me");
    expect(PROVIDERS.gisoo.validateUrl).not.toContain("/api/v1/models");
  });

  it("seeds the verified chat catalog while still accepting unlisted model ids", () => {
    expect(gisoo.passthroughModels).toBe(true);
    expect(PROVIDER_MODELS.gisoo.map((model) => model.id)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "gpt-5.6-sol",
      "gpt-5.5",
      "gemini-3.8-flash",
      "gemini-3.1-pro-preview",
      "deepseek-v4-pro",
      "deepseek-flash",
    ]);
  });

  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prices the seed models at the rates the relay publishes", () => {
    const pricing = getPricingForModel("gisoo", "claude-opus-5-5");
    expect(pricing).toMatchObject({ input: 5.6, output: 28, cached: 0.28 });
    expect(getPricingForModel("gisoo", "deepseek-flash")).toMatchObject({ input: 0.36, output: 1.44 });
  });
});

describe("Gisoo model discovery", () => {
  let requests;

  beforeEach(() => {
    requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      requests.push({ url: String(url), init });
      const parsed = new URL(String(url));
      if (parsed.pathname === CATALOG_PATH) return catalogResponse();
      return Response.json({ error: { message: "unexpected path", code: "unexpected" } }, { status: 500 });
    }));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("discovers the public catalog without sending the stored key anywhere", async () => {
    const connection = {
      id: "connection-gisoo",
      provider: "gisoo",
      apiKey: SYNTHETIC_KEY,
      accessToken: null,
      // A management caller can write this field; discovery must ignore it.
      providerSpecificData: { baseUrl: "https://attacker.example" },
    };

    const result = await fetchConnectionModels(connection);

    expect(result.error).toBeUndefined();
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.url).toBe(GISOO_MODELS_URL);
    const headers = new Headers(request.init?.headers || {});
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
    expect(JSON.stringify(request)).not.toContain(SYNTHETIC_KEY);
    expect(String(request.url)).not.toContain("attacker.example");
    expect(result.models.map((model) => model.id)).toEqual([
      "gpt-5.6-sol",
      "claude-opus-5-5",
      "openrouter/anthropic/claude-sonnet-4.5",
    ]);
  });

  it("maps the catalog rows onto the dashboard model shape", async () => {
    const result = await PROVIDER_MODELS_CONFIG.gisoo.customResolver(
      { provider: "gisoo", apiKey: SYNTHETIC_KEY, providerSpecificData: {} },
      null,
      null,
    );
    expect(result.models).toContainEqual({
      id: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      contextLength: 1050000,
      maxOutputTokens: 128000,
      supportsVision: true,
      supportsReasoning: true,
    });
  });

  it("keeps non-chat rows out of the chat catalog", () => {
    const models = parseGisooModels({ object: "list", data: catalogRows });
    expect(models.map((model) => model.id)).not.toContain("sora-2");
  });
});

describe("Gisoo credential validation", () => {
  it("accepts a key the account endpoint answers for", async () => {
    const fetcher = vi.fn(async () => Response.json({ balance: { usd: 10 }, status: "active" }));
    const result = await probeRegistryProvider("gisoo", SYNTHETIC_KEY, fetcher);
    expect(result.valid).toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://gisoo.pro/api/v1/me");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SYNTHETIC_KEY}`);
  });

  it("rejects a key the account endpoint refuses", async () => {
    const fetcher = vi.fn(async () => upstreamError(401, "invalid_api_key", "Invalid API key"));
    const result = await probeRegistryProvider("gisoo", SYNTHETIC_KEY, fetcher);
    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBe("Invalid API key");
  });
});

describe("Gisoo error classification", () => {
  const fallback = (status, message, body = null) =>
    checkFallbackError(status, message, 0, "gisoo", null, body);

  it("treats a rejected key as a credential failure, not as an exhausted balance", () => {
    const result = fallback(401, "[401]: Invalid API key");
    expect(result).toMatchObject({ shouldFallback: true, cooldownMs: 2 * 60 * 1000, scope: "connection" });
    expect(result.terminal).toBeUndefined();
  });

  it("treats an empty balance as a terminal account-wide state", () => {
    const result = fallback(402, "[402]: Insufficient credit");
    expect(result).toMatchObject({
      shouldFallback: true,
      cooldownMs: 24 * 60 * 60 * 1000,
      scope: "connection",
      terminal: true,
    });
  });

  it("treats a pending identity verification as its own terminal state", () => {
    const result = fallback(403, "[403]: Identity verification required");
    expect(result).toMatchObject({
      shouldFallback: true,
      cooldownMs: 24 * 60 * 60 * 1000,
      scope: "connection",
      terminal: true,
    });
  });

  it("keeps a plain model denial on the shared 403 path", () => {
    const result = fallback(403, "[403]: This key is not allowed for this model");
    expect(result.shouldFallback).toBe(true);
    expect(result.terminal).toBeUndefined();
    expect(result.scope).toBeNull();
    expect(result.cooldownMs).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it("keeps the three failure classes apart", () => {
    const auth = fallback(401, "[401]: Invalid API key");
    const credit = fallback(402, "[402]: Insufficient credit");
    const kyc = fallback(403, "[403]: Identity verification required");
    expect(new Set([auth.cooldownMs, credit.cooldownMs, kyc.cooldownMs]).size).toBe(2);
    expect(auth.terminal).toBeUndefined();
    expect(credit.terminal).toBe(true);
    expect(kyc.terminal).toBe(true);
    expect(auth.scope).toBe(credit.scope);
    expect(auth.scope).toBe(kyc.scope);
  });

  it("reads the documented error code when the upstream sends one", () => {
    const body = { error: { message: "Insufficient credit", code: "insufficient_credit" } };
    expect(getProviderErrorRuleMatch("gisoo", 402, null, body)).toMatchObject({ scope: "connection", terminal: true });
    expect(getProviderErrorRuleMatch("gisoo", 401, null, { error: { code: "invalid_api_key" } })).toMatchObject({
      scope: "connection",
    });
    expect(getProviderErrorRuleMatch("gisoo", 403, null, { error: { code: "kyc_required" } })).toMatchObject({
      scope: "connection",
      terminal: true,
    });
  });
});

describe("Gisoo chat traffic", () => {
  let dataDir;
  let postChat;
  let upstreamRequests;
  let connections;
  let clients;
  let chatHandler;
  let createConnection;
  let createKey;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "durindoor-gisoo-fixture-"));
    vi.stubEnv("DATA_DIR", dataDir);

    upstreamRequests = [];
    chatHandler = null;
    vi.stubGlobal("fetch", async (url, init) => {
      upstreamRequests.push({ url: String(url), init });
      const parsed = new URL(String(url));
      if (parsed.pathname === CATALOG_PATH) return catalogResponse();
      if (parsed.pathname === ACCOUNT_PATH) return Response.json({ balance: { usd: 25 }, status: "active" });
      if (parsed.pathname === CHAT_PATH) {
        const body = JSON.parse(init.body);
        return chatHandler ? chatHandler(body, init) : chatResponse({ stream: body.stream === true });
      }
      return Response.json({ error: { message: "unexpected path", code: "unexpected" } }, { status: 500 });
    });

    const { createProviderConnection } = await import("@/lib/db/repos/connectionsRepo.js");
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    ({ POST: postChat } = await import("@/app/api/v1/chat/completions/route.js"));
    createConnection = createProviderConnection;
    createKey = createApiKey;

    await updateSettings({ requireApiKey: true, visionBridgeEnabled: false });
    connections = {};
    clients = {};
    for (const [name, key] of [["main", SYNTHETIC_KEY], ["second", SYNTHETIC_KEY_SECOND]]) {
      connections[name] = await createProviderConnection({
        provider: "gisoo",
        authType: "apikey",
        name,
        apiKey: key,
        isActive: true,
        testStatus: "active",
      });
      clients[name] = (await createApiKey(name, "fixture-machine", [], null, null, {
        providerConnectionIds: [connections[name].id],
      })).key;
    }
    // One key that may use either account, so the router can pick the rejected
    // one first and rotate to the other.
    clients.rotating = (await createApiKey("rotating", "fixture-machine", [], null, null, {
      providerConnectionIds: [connections.main.id, connections.second.id],
    })).key;
  }, 30000);

  beforeEach(() => {
    upstreamRequests.length = 0;
    chatHandler = null;
  });

  afterAll(async () => {
    try {
      await globalThis._dbAdapter?.instance?.close?.();
      delete globalThis._dbAdapter;
      if (dataDir) await rm(dataDir, { recursive: true, force: true });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  function chat(model, key, stream = false) {
    return postChat(new Request("http://durindoor.invalid/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key && { authorization: `Bearer ${key}` }) },
      // A streaming client asks for the usage trailer; an unrequested one is dropped.
      body: JSON.stringify({ model, stream, ...(stream && { stream_options: { include_usage: true } }), messages: [{ role: "user", content: "hello" }] }),
    }));
  }

  /**
   * A dedicated account (and a key scoped to it) so one scenario's cooldown
   * never decides another scenario's outcome.
   */
  async function freshAccount(name) {
    const connection = await createConnection({
      provider: "gisoo",
      authType: "apikey",
      name,
      apiKey: `sk-gisoo-v1-synthetic-${name}-0000000000`,
      isActive: true,
      testStatus: "active",
    });
    return (await createKey(name, "fixture-machine", [], null, null, {
      providerConnectionIds: [connection.id],
    })).key;
  }

  it("routes JSON through the selected connection with its own key", async () => {
    const response = await chat("gisoo/gpt-5.6-sol", clients.main);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      choices: [{ message: { content: "gisoo reply" } }],
      usage: addBufferToUsage(chatUsage),
    });
    const dispatched = upstreamRequests.filter((request) => request.url.includes(CHAT_PATH));
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].url).toBe("https://gisoo.pro/api/v1/chat/completions");
    expect(new Headers(dispatched[0].init.headers).get("authorization")).toBe(`Bearer ${SYNTHETIC_KEY}`);
  });

  it("routes SSE through the same connection", async () => {
    const response = await chat("gisoo/gpt-5.6-sol", clients.main, true);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await response.text();
    expect(events).toContain("gisoo reply");
    expect(events).toContain(`"total_tokens":${addBufferToUsage(chatUsage).total_tokens}`);
    expect(events).toContain("data: [DONE]");
    const dispatched = upstreamRequests.filter((request) => request.url.includes(CHAT_PATH));
    expect(new Headers(dispatched[0].init.headers).get("authorization")).toBe(`Bearer ${SYNTHETIC_KEY}`);
  });

  it("keeps each account's credential isolated when one key is rejected", async () => {
    let attempts = 0;
    chatHandler = (body) => {
      attempts += 1;
      // The first account the router picks is rejected; the next one answers.
      if (attempts === 1) return upstreamError(401, "invalid_api_key", "Invalid API key");
      return chatResponse({ stream: body.stream === true });
    };

    const response = await chat("gisoo/gpt-5.6-sol", clients.rotating);
    expect(response.status).toBe(200);
    const dispatched = upstreamRequests.filter((request) => request.url.includes(CHAT_PATH));
    expect(dispatched.length).toBeGreaterThanOrEqual(2);
    const authorizations = dispatched.map((request) => new Headers(request.init.headers).get("authorization"));
    // Every attempt presents exactly one account's key ...
    expect(authorizations.every((value) => value === `Bearer ${SYNTHETIC_KEY}` || value === `Bearer ${SYNTHETIC_KEY_SECOND}`)).toBe(true);
    // ... the retry uses the other account's key, not the rejected one again ...
    expect(new Set(authorizations).size).toBe(authorizations.length);
    expect(authorizations[0]).not.toBe(authorizations[authorizations.length - 1]);
  });

  it("surfaces an empty balance as a billing failure", async () => {
    const scoped = await freshAccount("credit");
    chatHandler = () => upstreamError(402, "insufficient_credit", "Insufficient credit");
    const response = await chat("gisoo/gpt-5.6-sol", scoped);
    expect(response.status).toBe(402);
    expect(await response.text()).toContain("credit");
  });

  it("surfaces a pending identity verification as a permission failure", async () => {
    const scoped = await freshAccount("kyc");
    chatHandler = () => upstreamError(403, "kyc_required", "Identity verification required");
    const response = await chat("gisoo/gpt-5.6-sol", scoped);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("verification");
  });
});
