// All-modality weighted combo dispatch test (#748) — proves the per-member
// weights persisted on the combo row reach every combo-enabled handler seam
// (chat, image, tts, fetch, search) through the shared handleComboChat
// pipeline, AND that the dispatch loop falls back to the next member when the
// weighted first choice returns a retryable error.
//
// Uses real modality-capable providers (no fake `p/heavy` ids). Mocks the
// persisted combo/auth snapshots and network boundary while the real handler,
// model resolver, executor, and shared handleComboChat dispatch loop run.
// Existing direct getWeightedModels tests cover the pure helper; this file
// proves weights reach real modality dispatch and retryable fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

const mocks = vi.hoisted(() => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
  getApiKeyByKey: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  getComboByName: vi.fn(async () => null),
  getComboForModel: vi.fn(async () => null),
  getCustomModels: vi.fn(async () => []),
  getDisabledModels: vi.fn(async () => ({})),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
  getProviderConnections: vi.fn(async () => []),
  getApiKeyUsageLimitStatus: vi.fn(async () => ({ allowed: true, remaining: null })),
  getQuotaReservationPressure: vi.fn(async () => 0),
   getSettings: vi.fn(async () => ({ requireApiKey: false, comboStrategy: "weighted" })),
   getAutoComboCatalog: vi.fn(async () => ({})),
  recordApiKeyUsageForResponse: vi.fn(async (_apiKey, response) => response),
  // Mirrors unrestricted no-auth selection after the canonical helper strips
  // its synthetic `noauth` connection metadata.
  getNoAuthProviderCredentials: vi.fn(async () => ({})),
  getProviderCredentialsWithQuotaPreflight: vi.fn(async () => ({
    apiKey: "test-key",
    connectionId: "test-connection",
    connectionName: "test-connection",
    _connection: { id: "test-connection" },
  })),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: mocks.getApiKeyByKey,
  getCombos: mocks.getCombos,
  getComboByName: mocks.getComboByName,
  getComboForModel: mocks.getComboForModel,
  getCustomModels: mocks.getCustomModels,
  getDisabledModels: mocks.getDisabledModels,
  getModelAliases: mocks.getModelAliases,
  getProviderNodes: mocks.getProviderNodes,
  getProviderConnections: mocks.getProviderConnections,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/usageDb", () => ({
  appendRequestLog: vi.fn(async () => {}),
  finishActiveSession: vi.fn(),
  recordTokenSaverEvent: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/shared/services/providerRateLimitEvidence", async (importOriginal) => ({
  ...(await importOriginal()),
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  clearAccountError: vi.fn(),
  getNoAuthProviderCredentials: mocks.getNoAuthProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentialsWithQuotaPreflight,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  projectProviderCredentials: vi.fn((connection) => connection),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true } })),
  providerAllowsPublicNoAuthFallback: vi.fn(() => true),
  isProviderConnectionModelLocked: vi.fn(() => false),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
  recordApiKeyUsageForResponse: mocks.recordApiKeyUsageForResponse,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("../../src/sse/utils/logger.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    request: vi.fn(),
    warn: vi.fn(),
  };
});
vi.mock("../../src/sse/utils/requestCorrelation.js", async (importOriginal) => ({
  ...(await importOriginal()),
  withRequestCorrelation: (fn) => async (request) => fn(request),
  getRequestId: () => "test-req",
}));

const originalFetch = globalThis.fetch;
let restoreProxyFetch = () => {};

// Each modality-specific combo has a real `provider/model` shape so the
// production getModelInfo/getComboModels resolves genuine model strings and
// the dispatch loop forwards them through handleComboChat. Members differ in
// weight; tests assert (a) the heavy-weight member dispatches first, and
// (b) the loop falls back to the second member on a retryable first-pass
// failure.

const CHAT_HEAVY = "duckduckgo-web/gpt-5-mini";
const CHAT_LIGHT = "duckduckgo-web/llama-4-scout";
const CHAT_COMBO = {
  id: "chat-combo",
  name: "weighted-chat",
  kind: null,
  models: [CHAT_HEAVY, CHAT_LIGHT],
  members: [{ id: CHAT_HEAVY, weight: 1000 }, { id: CHAT_LIGHT, weight: 1 }],
  invariant: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// sdwebui (heavy) and comfyui (light) are two DISTINCT noAuth image providers
// with different base URLs (localhost:7860 vs localhost:8188), so dispatch
// order and fallback are both distinguishable at the network layer.
const IMAGE_HEAVY = "sdwebui/stable-diffusion-v1-5";
const IMAGE_LIGHT = "comfyui/sdxl";
const IMAGE_COMBO = {
  id: "image-combo",
  name: "weighted-image",
  kind: null,
  models: [IMAGE_HEAVY, IMAGE_LIGHT],
  members: [{ id: IMAGE_HEAVY, weight: 1000 }, { id: IMAGE_LIGHT, weight: 1 }],
  invariant: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const TTS_HEAVY = "edge-tts/en-US-AriaNeural";
const TTS_LIGHT = "edge-tts/en-US-GuyNeural";
const TTS_COMBO = {
  id: "tts-combo",
  name: "weighted-tts",
  kind: null,
  models: [TTS_HEAVY, TTS_LIGHT],
  members: [{ id: TTS_HEAVY, weight: 1000 }, { id: TTS_LIGHT, weight: 1 }],
  invariant: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const FETCH_HEAVY = "firecrawl_custom";
const FETCH_LIGHT = "jina-reader";
const FETCH_COMBO = {
  id: "fetch-combo",
  name: "weighted-fetch",
  kind: null,
  models: [FETCH_HEAVY, FETCH_LIGHT],
  members: [{ id: FETCH_HEAVY, weight: 1000 }, { id: FETCH_LIGHT, weight: 1 }],
  invariant: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const SEARCH_HEAVY = "searxng";
const SEARCH_LIGHT = "linkup";
const SEARCH_COMBO = {
  id: "search-combo",
  name: "weighted-search",
  kind: null,
  models: [SEARCH_HEAVY, SEARCH_LIGHT],
  members: [{ id: SEARCH_HEAVY, weight: 1000 }, { id: SEARCH_LIGHT, weight: 1 }],
  invariant: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// Builds a fetch mock that recognizes every upstream URL used by the five
// modality combos above, and can be told to fail the heavy or light member's
// first attempt with a retryable status so combo fallback is exercised.
function makeFetch({ failureOnHeavy = false, failureOnLight = false } = {}) {
  let sdCalls = 0;
  return vi.fn(async (url, init) => {
    const u = String(url);

    // Edge TTS: token bootstrap (Bing translator HTML) then speech synth.
    if (u.startsWith("https://www.bing.com/translator")) {
      return new Response(
        `var params_AbusePreventionHelper = [ "K1", "T1", 63840000000 ];`,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }
    if (u.startsWith("https://www.bing.com/tfettts")) {
      const body = init?.body && typeof init.body === "string" ? init.body : "";
      const isAria = body.includes("AriaNeural");
      if (isAria && failureOnHeavy) return new Response("err", { status: 503 });
      if (!isAria && failureOnLight) return new Response("err", { status: 503 });
      const audio = Buffer.alloc(2048, 0x42); // >=1024 bytes, passes edge adapter's empty-audio guard
      return new Response(audio, { status: 200, headers: { "content-type": "audio/mpeg" } });
    }

    // DuckDuckGo chat executor: status probe then chat completion.
    if (u.startsWith("https://duckduckgo.com/duckchat/v1/status")) {
      return new Response("", { status: 200, headers: { "x-vqd-4": "test-vqd" } });
    }
    if (u.startsWith("https://duckduckgo.com/duckchat/v1/chat")) {
      const body = init?.body && typeof init.body === "string" ? safeJson(init.body) : null;
      const model = body?.model;
      const isHeavy = model === "gpt-5-mini";
      if (isHeavy && failureOnHeavy) return new Response("err", { status: 502 });
      if (!isHeavy && failureOnLight) return new Response("err", { status: 502 });
      return new Response(
        `data: ${JSON.stringify({ message: "ok from " + model, model })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } }
      );
    }

    // SD WebUI (heavy image member) — always localhost:7860 regardless of model.
    if (u.includes("localhost:7860")) {
      sdCalls += 1;
      if (failureOnHeavy) return new Response("err", { status: 502 });
      return new Response(JSON.stringify({ images: ["/9j/AAAA"] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    // ComfyUI (light image fallback member) — localhost:8188.
    if (u.includes("localhost:8188")) {
      if (failureOnLight) return new Response("err", { status: 502 });
      return new Response(JSON.stringify({ created: 1, data: [{ b64_json: "/9j/AAAA" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Firecrawl (heavy fetch member) — POSTs to /v2/scrape for firecrawl_custom.
    if (u.includes("/v2/scrape")) {
      if (failureOnHeavy) return new Response("err", { status: 502 });
      return new Response(
        JSON.stringify({ success: true, data: { markdown: "ok", metadata: { title: "ok" } } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    // Jina Reader (light fetch fallback member) — GETs https://r.jina.ai/<url>.
    if (u.includes("r.jina.ai")) {
      if (failureOnLight) return new Response("err", { status: 502 });
      return new Response("# ok\n\nok", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      });
    }

    // SearXNG (heavy search member) — GET <base>/search?q=...&format=json.
    if (u.includes("/search?") && !u.includes("api.linkup")) {
      if (failureOnHeavy) return new Response("err", { status: 502 });
      return new Response(
        JSON.stringify({ results: [{ title: "ok", url: "https://example.com", content: "ok" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    // Linkup (light search fallback member) — POSTs to api.linkup.so.
    if (u.includes("api.linkup")) {
      if (failureOnLight) return new Response("err", { status: 502 });
      return new Response(
        JSON.stringify({ results: [{ title: "ok", url: "https://example.com", content: "ok" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

function setCombo(combo) {
  mocks.getComboByName.mockImplementation(async (name) => (name === combo.name ? combo : null));
  mocks.getComboForModel.mockImplementation(async (name) => (name === combo.name ? combo : null));
  mocks.getCombos.mockResolvedValue([combo]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderCredentialsWithQuotaPreflight.mockResolvedValue({
    apiKey: "test-key",
    connectionId: "test-connection",
    connectionName: "test-connection",
    _connection: { id: "test-connection" },
  });
  // Force the highest weight to win: Math.pow(0.999, 1/1000) > Math.pow(0.001, 1).
  vi.spyOn(Math, "random").mockReturnValue(0.999);
});

afterEach(() => {
  restoreProxyFetch();
  restoreProxyFetch = () => {};
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("weighted combo dispatch: heavy member chosen first", () => {
  it("chat route dispatches the heavy-weight model first", async () => {
    setCombo(CHAT_COMBO);
    const upstreamFetch = makeFetch();
    globalThis.fetch = upstreamFetch;
    restoreProxyFetch = __setOriginalFetchForTesting(upstreamFetch);
    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "weighted-chat", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await handleChat(req);
    expect(res.status, await res.clone().text()).toBe(200);
    const chatCall = upstreamFetch.mock.calls.find(([url]) => String(url).startsWith("https://duckduckgo.com/duckchat/v1/chat"));
    expect(chatCall).toBeDefined();
    expect(safeJson(chatCall[1].body)?.model).toBe("gpt-5-mini");
  });

  it("image generation route dispatches the heavy-weight provider (sdwebui) first", async () => {
    setCombo(IMAGE_COMBO);
    globalThis.fetch = makeFetch();
    const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");
    const req = new Request("http://localhost/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "weighted-image", prompt: "a cat" }),
    });
    const res = await handleImageGeneration(req);
    expect(res.status, await res.clone().text()).toBe(200);
    const sdwebui = globalThis.fetch.mock.calls.find(([url]) => String(url).includes("localhost:7860"));
    const comfyui = globalThis.fetch.mock.calls.find(([url]) => String(url).includes("localhost:8188"));
    expect(sdwebui).toBeDefined();
    expect(comfyui).toBeUndefined(); // heavy succeeded — no fallback needed
  });

  it("tts route dispatches the heavy-weight voice first", async () => {
    setCombo(TTS_COMBO);
    globalThis.fetch = makeFetch();
    const { handleTts } = await import("../../src/sse/handlers/tts.js");
    const req = new Request("http://localhost/v1/audio/speech?response_format=mp3", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "weighted-tts", input: "hi" }),
    });
    const res = await handleTts(req);
    expect(res.status, await res.clone().text()).toBe(200);
    const synth = globalThis.fetch.mock.calls.find(([url]) => String(url).includes("tfettts"));
    expect(synth).toBeDefined();
    expect(String(synth[1].body)).toContain("AriaNeural");
  });

  it("web fetch route dispatches the heavy-weight provider (firecrawl_custom) first", async () => {
    setCombo(FETCH_COMBO);
    const upstreamFetch = makeFetch();
    globalThis.fetch = upstreamFetch;
    restoreProxyFetch = __setOriginalFetchForTesting(upstreamFetch);
    const { handleFetch } = await import("../../src/sse/handlers/fetch.js");
    const req = new Request("http://localhost/v1/web/fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "weighted-fetch", url: "https://example.com" }),
    });
    const res = await handleFetch(req);
    expect(res.status, await res.clone().text()).toBe(200);
    await expect(res.clone().json()).resolves.toMatchObject({
      provider: "firecrawl_custom",
      content: { format: "markdown", text: "ok", length: 2 },
    });
    const firecrawl = upstreamFetch.mock.calls.find(([url]) => String(url).includes("/v2/scrape"));
    expect(firecrawl).toBeDefined();
  });

  it("web search route dispatches the heavy-weight provider (searxng) first", async () => {
    setCombo(SEARCH_COMBO);
    globalThis.fetch = makeFetch();
    const { handleSearch } = await import("../../src/sse/handlers/search.js");
    const req = new Request("http://localhost/v1/web/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "weighted-search", query: "durindoor" }),
    });
    const res = await handleSearch(req);
    expect(res.status, await res.clone().text()).toBe(200);
    const searxng = globalThis.fetch.mock.calls.find(([url]) => /\/search\?/.test(String(url)) && !String(url).includes("api.linkup"));
    expect(searxng).toBeDefined();
  });
});

describe("weighted combo dispatch: falls back to the next member on a retryable first-pass failure", () => {
  it("chat route falls back to the light model when the heavy choice 502s", async () => {
    setCombo(CHAT_COMBO);
    const upstreamFetch = makeFetch({ failureOnHeavy: true });
    globalThis.fetch = upstreamFetch;
    restoreProxyFetch = __setOriginalFetchForTesting(upstreamFetch);
    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "weighted-chat", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await handleChat(req);
    expect(res.status, await res.clone().text()).toBe(200);
    const chatCalls = upstreamFetch.mock.calls.filter(([url]) => String(url).startsWith("https://duckduckgo.com/duckchat/v1/chat"));
    expect(chatCalls.length).toBe(2);
    expect(safeJson(chatCalls[0][1].body)?.model).toBe("gpt-5-mini"); // heavy first
    expect(safeJson(chatCalls[1][1].body)?.model).toBe("meta-llama/Llama-4-Scout-17B-16E-Instruct"); // light fallback
  });

  it("image generation route falls back to comfyui when sdwebui 502s", async () => {
    setCombo(IMAGE_COMBO);
    globalThis.fetch = makeFetch({ failureOnHeavy: true });
    const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");
    const req = new Request("http://localhost/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "weighted-image", prompt: "a cat" }),
    });
    const res = await handleImageGeneration(req);
    expect(res.status, await res.clone().text()).toBe(200);
    const sdwebui = globalThis.fetch.mock.calls.find(([url]) => String(url).includes("localhost:7860"));
    const comfyui = globalThis.fetch.mock.calls.find(([url]) => String(url).includes("localhost:8188"));
    expect(sdwebui).toBeDefined(); // heavy attempted first
    expect(comfyui).toBeDefined(); // light attempted as fallback
  });

  it("tts route falls back to the light voice when the heavy choice 503s", async () => {
    setCombo(TTS_COMBO);
    globalThis.fetch = makeFetch({ failureOnHeavy: true });
    const { handleTts } = await import("../../src/sse/handlers/tts.js");
    const req = new Request("http://localhost/v1/audio/speech?response_format=mp3", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "weighted-tts", input: "hi" }),
    });
    const res = await handleTts(req);
    expect(res.status, await res.clone().text()).toBe(200);
    const synths = globalThis.fetch.mock.calls.filter(([url]) => String(url).includes("tfettts"));
    expect(synths.length).toBeGreaterThanOrEqual(2);
    expect(String(synths[0][1].body)).toContain("AriaNeural"); // heavy first
    expect(String(synths[1][1].body)).toContain("GuyNeural"); // light fallback
  });

  it("web fetch route falls back to jina-reader when firecrawl_custom 502s", async () => {
    setCombo(FETCH_COMBO);
    const upstreamFetch = makeFetch({ failureOnHeavy: true });
    globalThis.fetch = upstreamFetch;
    restoreProxyFetch = __setOriginalFetchForTesting(upstreamFetch);
    const { handleFetch } = await import("../../src/sse/handlers/fetch.js");
    const req = new Request("http://localhost/v1/web/fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "weighted-fetch", url: "https://example.com" }),
    });
    const res = await handleFetch(req);
    expect(res.status, await res.clone().text()).toBe(200);
    await expect(res.clone().json()).resolves.toMatchObject({
      provider: "jina-reader",
      content: { format: "markdown", text: "# ok\n\nok", length: 8 },
    });
    const firecrawl = upstreamFetch.mock.calls.find(([url]) => String(url).includes("/v2/scrape"));
    const jina = upstreamFetch.mock.calls.find(([url]) => String(url).includes("r.jina.ai"));
    expect(firecrawl).toBeDefined();
    expect(jina).toBeDefined();
  });

  it("web search route falls back to linkup when searxng 502s", async () => {
    setCombo(SEARCH_COMBO);
    globalThis.fetch = makeFetch({ failureOnHeavy: true });
    const { handleSearch } = await import("../../src/sse/handlers/search.js");
    const req = new Request("http://localhost/v1/web/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "weighted-search", query: "durindoor" }),
    });
    const res = await handleSearch(req);
    expect(res.status, await res.clone().text()).toBe(200);
    const searxng = globalThis.fetch.mock.calls.find(([url]) => /\/search\?/.test(String(url)) && !String(url).includes("api.linkup"));
    const linkup = globalThis.fetch.mock.calls.find(([url]) => String(url).includes("api.linkup"));
    expect(searxng).toBeDefined();
    expect(linkup).toBeDefined();
  });
});

describe("combo response validation", () => {
  it("accepts normalized fetch content only when content.text is non-empty", async () => {
    const { handleComboChat } = await import("../../open-sse/services/combo.js");
    const response = (content) => new Response(
      JSON.stringify({ provider: "fixture", content }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
    const dispatch = async (firstContent) => {
      const handleSingleModel = vi.fn(async (_body, model) => response(
        model === "p/first"
          ? firstContent
          : { format: "markdown", text: "fallback", length: 8 }
      ));
      const result = await handleComboChat({
        body: { url: "https://example.com" },
        models: ["p/first", "p/second"],
        handleSingleModel,
        log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
        comboName: "fetch-content",
        comboStrategy: "fallback",
      });
      return {
        body: await result.json(),
        calls: handleSingleModel.mock.calls.map(([, model]) => model),
      };
    };

    await expect(dispatch({ format: "markdown", text: "content", length: 7 })).resolves.toEqual({
      body: { provider: "fixture", content: { format: "markdown", text: "content", length: 7 } },
      calls: ["p/first"],
    });
    await expect(dispatch({ format: "markdown", text: "", length: 0 })).resolves.toEqual({
      body: { provider: "fixture", content: { format: "markdown", text: "fallback", length: 8 } },
      calls: ["p/first", "p/first", "p/second"],
    });
    await expect(dispatch({ format: "markdown", length: 7 })).resolves.toEqual({
      body: { provider: "fixture", content: { format: "markdown", text: "fallback", length: 8 } },
      calls: ["p/first", "p/first", "p/second"],
    });
  });
});
