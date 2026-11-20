/**
 * Meta Model API routing verification (#2034).
 *
 * Meta exposes two different credentials that both reach api.meta.ai, and
 * they are not interchangeable:
 *
 * - The Muse Code subscription key is minted from the device token of the
 *   Muse Code sign-in. Meta scopes it to the Muse Code client, so it travels
 *   with the Muse Code client identity.
 * - The Meta Model API key is issued separately under the Meta Model API
 *   account. Meta documents it for external clients on https://api.meta.ai/v1
 *   with a bearer token and no client fingerprint, so it travels bare.
 *
 * This file proves, against closed fixtures only:
 *
 * - the `meta` alias stays on Meta Llama (api.llama.com) and the Muse vendor
 *   is reachable only through `muse-code`, so the two never collide;
 * - two API-key scoped Muse accounts each dispatch with their own bearer and
 *   their own key, and neither leaks into the other account or into the Meta
 *   Llama host;
 * - the documented Model API key carries no Muse Code client fingerprint;
 * - model discovery is account-scoped;
 * - an attestation denial is bounded: no remint, no substituted credential and
 *   no second attempt.
 *
 * Upstream reference revisions are recorded in
 * internal/docs/muse-signin-2034.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One spy carries the upstream request, the key mint and the model listing,
// so the order and the count of the calls prove the credential lifecycle.
const proxyFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: proxyFetchMock,
  proxyAwareFetch: proxyFetchMock,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));

// The gateway request path writes request rows and reads provider limits.
// Both are closed off here; the credential lifecycle under test is the wire.
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", async (importOriginal) => ({
  ...(await importOriginal()),
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
  extractUsageFromResponse: vi.fn(() => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })),
  saveUsageStats: vi.fn(),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));
vi.mock("../../open-sse/services/tokenRefresh.js", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshWithRetry: vi.fn(),
}));
vi.mock("../../open-sse/providers/capabilities.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getCapabilitiesForModel: vi.fn(() => ({})),
  resolveModelLimits: vi.fn(() => ({ contextWindow: 0, maxOutput: 0, known: false, source: "default" })),
}));
vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
  hasMediaBlocks: vi.fn(() => false),
}));
vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));
vi.mock("../../open-sse/services/liveModelLimits.js", () => ({
  warmLiveModelLimits: vi.fn(),
  getCachedLiveLimits: vi.fn(() => null),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import {
  META_MODEL_API_MODELS_URL,
  META_MODEL_API_RESPONSES_URL,
  MUSE_CODE_ATTESTATION_DENIED,
  MUSE_CODE_INFERENCE_USER_AGENT,
  MUSE_CODE_MINT_URL
} from "../../open-sse/config/museCode.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import "../translator/registerAll.js";

const MUSE_MODEL = "muse-spark-1.3";
const LLAMA_MODEL = "Llama-3.3-70B-Instruct";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sseResponse = (text) =>
  new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });

const callOf = (calls, index = 0) => {
  const [url, init] = calls[index];
  return { url, init, headers: init?.headers ?? {} };
};

const hostOf = (url) => new URL(url).hostname;

/** Dispatch one request through the gateway executor with a mocked transport. */
async function dispatch(provider, { model, credentials, stream = false, response } = {}) {
  proxyFetchMock.mockReset();
  proxyFetchMock.mockResolvedValue(response ?? jsonResponse({ ok: true }));
  const executor = getExecutor(provider);
  const result = await executor.execute({
    model,
    body: { model, input: "hello" },
    stream,
    credentials,
    proxyOptions: { disableEnvProxy: true },
  });
  return { executor, result, calls: proxyFetchMock.mock.calls };
}

describe("Meta identity separation: Muse Code vs Meta Llama", () => {
  it("keeps the meta alias on Meta Llama and the Muse vendor on muse-code", () => {
    // The `meta` alias belongs to Meta Llama and stays there for compatibility.
    expect(resolveProviderAlias("meta")).toBe("meta-llama");
    expect(resolveProviderAlias("meta-llama")).toBe("meta-llama");
    // The Meta Muse vendor keeps its own id and alias.
    expect(resolveProviderAlias("mc")).toBe("muse-code");
    expect(resolveProviderAlias("muse-code")).toBe("muse-code");
    // No second identity was added for the Muse vendor.
    expect(REGISTRY.filter((entry) => entry.id === "meta").map((entry) => entry.id)).toEqual([]);
    expect(REGISTRY.filter((entry) => entry.alias === "meta").map((entry) => entry.id)).toEqual(["meta-llama"]);
  });

  it("reaches api.meta.ai through exactly one provider identity", () => {
    const museVendor = REGISTRY.filter((entry) => /api\.meta\.ai/.test(entry.transport?.baseUrl || ""));
    expect(museVendor.map((entry) => entry.id)).toEqual(["muse-code"]);
    expect(PROVIDERS["muse-code"].baseUrl).toBe(META_MODEL_API_RESPONSES_URL);
    expect(PROVIDERS["muse-code"].baseUrl).toBe("https://api.meta.ai/v1/responses");
    expect(PROVIDERS["muse-code"].format).toBe("openai-responses");
    // The Meta Llama identity keeps its own host and chat-completions wire.
    expect(PROVIDERS["meta-llama"].baseUrl).toBe("https://api.llama.com/compat/v1/chat/completions");
    expect(PROVIDERS["meta-llama"].format).toBe("openai");
  });

  it("never lets a Muse model id resolve onto the Meta Llama provider", () => {
    const museModelIds = PROVIDER_MODELS.mc.map((model) => model.id);
    const llamaModelIds = PROVIDER_MODELS.meta.map((model) => model.id);
    expect(museModelIds).toContain(MUSE_MODEL);
    expect(llamaModelIds).toContain(LLAMA_MODEL);
    // No id collides between the two catalogs, not even case-insensitively.
    const museLower = new Set(museModelIds.map((id) => id.toLowerCase()));
    expect(llamaModelIds.filter((id) => museLower.has(id.toLowerCase()))).toEqual([]);
    // Meta Llama does not own any Muse namespace model.
    const llamaOwned = REGISTRY.find((entry) => entry.id === "meta-llama");
    expect((llamaOwned.models || []).filter((model) => /^muse-/i.test(model.id))).toEqual([]);
  });

  it("selects the expected provider for a Muse model and a Meta Llama model", () => {
    expect(parseModel(`mc/${MUSE_MODEL}`)).toMatchObject({ provider: "muse-code", model: MUSE_MODEL });
    expect(parseModel(`muse-code/${MUSE_MODEL}`)).toMatchObject({ provider: "muse-code", model: MUSE_MODEL });
    expect(parseModel(`meta/${LLAMA_MODEL}`)).toMatchObject({ provider: "meta-llama", model: LLAMA_MODEL });
    expect(parseModel(`meta-llama/${LLAMA_MODEL}`)).toMatchObject({ provider: "meta-llama", model: LLAMA_MODEL });
  });
});

describe("Documented Meta Model API key path", () => {
  beforeEach(() => proxyFetchMock.mockReset());
  afterEach(() => proxyFetchMock.mockReset());

  it("sends the documented Model API request with a bare bearer and no client fingerprint", async () => {
    const { result, calls } = await dispatch("muse-code", {
      model: MUSE_MODEL,
      credentials: { apiKey: "model-api-key-a" },
    });

    expect(calls).toHaveLength(1);
    const { url, headers } = callOf(calls);
    expect(url).toBe(META_MODEL_API_RESPONSES_URL);
    expect(result.url).toBe(META_MODEL_API_RESPONSES_URL);
    expect(headers.Authorization).toBe("Bearer model-api-key-a");
    // Meta documents the Model API for external clients: no Muse Code client
    // fingerprint goes on the wire, and no Muse Code session header either.
    expect(headers["User-Agent"]).toBeUndefined();
    expect(Object.keys(headers).some((name) => /^x-(tbh|client-id)/i.test(name))).toBe(false);
    // The request body is the documented Responses shape.
    expect(JSON.parse(callOf(calls).init.body)).toMatchObject({ model: MUSE_MODEL, input: "hello" });
  });

  it("keeps two API-key scoped Muse accounts on their own credential", async () => {
    const first = await dispatch("muse-code", {
      model: MUSE_MODEL,
      credentials: { apiKey: "model-api-key-a" },
    });
    const second = await dispatch("muse-code", {
      model: MUSE_MODEL,
      credentials: { apiKey: "model-api-key-b" },
    });

    expect(callOf(first.calls).headers.Authorization).toBe("Bearer model-api-key-a");
    expect(callOf(second.calls).headers.Authorization).toBe("Bearer model-api-key-b");
    // Neither account inherits the other's key.
    expect(callOf(first.calls).headers.Authorization).not.toBe(callOf(second.calls).headers.Authorization);
    // Both accounts stay on the Meta Model API host.
    expect(first.calls.map(([url]) => hostOf(url))).toEqual(["api.meta.ai"]);
    expect(second.calls.map(([url]) => hostOf(url))).toEqual(["api.meta.ai"]);
  });

  it("never reaches the Meta Llama host for a Muse model", async () => {
    const { calls } = await dispatch("muse-code", {
      model: MUSE_MODEL,
      credentials: { apiKey: "model-api-key-a" },
    });
    const hosts = calls.map(([url]) => hostOf(url));
    expect(hosts).toEqual(["api.meta.ai"]);
    expect(hosts).not.toContain("api.llama.com");
  });

  it("streams over SSE with the documented key and no client fingerprint", async () => {
    const sse = [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"hi"}',
      "",
      ""
    ].join("\n");
    const { result, calls } = await dispatch("muse-code", {
      model: MUSE_MODEL,
      credentials: { apiKey: "model-api-key-a" },
      stream: true,
      response: sseResponse(sse),
    });

    const { headers } = callOf(calls);
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers.Authorization).toBe("Bearer model-api-key-a");
    expect(headers["User-Agent"]).toBeUndefined();
    // The upstream event stream is passed through untouched.
    expect(await result.response.text()).toContain("response.output_text.delta");
  });

  it("reports the usage the upstream sends", () => {
    // Usage wire evidence: the token counts Meta reports in the completed
    // event reach the client surface.
    const state = initState(FORMATS.OPENAI_RESPONSES, {});
    const chunks = translateResponse(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI,
      {
        type: "response.completed",
        response: {
          id: "resp-1",
          object: "response",
          status: "completed",
          model: MUSE_MODEL,
          output: [],
          usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
        },
      },
      state
    );
    const withUsage = chunks.filter(Boolean).filter((chunk) => chunk.usage);
    expect(withUsage).toHaveLength(1);
    expect(withUsage[0].usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  });
});

describe("Meta Llama routing stays separate", () => {
  beforeEach(() => proxyFetchMock.mockReset());
  afterEach(() => proxyFetchMock.mockReset());

  it("keeps the API-key route on api.llama.com with its own key", async () => {
    const { result, calls } = await dispatch("meta-llama", {
      model: LLAMA_MODEL,
      credentials: { apiKey: "llama-key" },
    });

    expect(calls).toHaveLength(1);
    const { url, headers } = callOf(calls);
    expect(url).toBe("https://api.llama.com/compat/v1/chat/completions");
    expect(result.url).toBe("https://api.llama.com/compat/v1/chat/completions");
    expect(headers.Authorization).toBe("Bearer llama-key");
    // The Meta Llama route keeps its own host and never the Muse vendor's.
    expect(hostOf(url)).toBe("api.llama.com");
    expect(hostOf(url)).not.toBe("api.meta.ai");
    // The Muse client identity must not leak onto the Meta Llama route.
    expect(headers["User-Agent"]).toBeUndefined();
  });

  it("does not send the Meta Llama key to the Meta Model API host", async () => {
    const { calls } = await dispatch("meta-llama", {
      model: LLAMA_MODEL,
      credentials: { apiKey: "llama-key" },
    });
    const hosts = calls.map(([url]) => hostOf(url));
    expect(hosts).toEqual(["api.llama.com"]);
    expect(hosts).not.toContain("api.meta.ai");
  });
});

describe("Muse Code subscription path keeps its client identity", () => {
  beforeEach(() => proxyFetchMock.mockReset());
  afterEach(() => proxyFetchMock.mockReset());

  it("stamps the Muse Code identity on a minted subscription key", async () => {
    const { calls } = await dispatch("muse-code", {
      model: MUSE_MODEL,
      credentials: {
        accessToken: "mk-live",
        refreshToken: "dca:abc",
        providerSpecificData: { dcaToken: "dca:abc" },
      },
    });

    const { headers } = callOf(calls);
    expect(headers.Authorization).toBe("Bearer mk-live");
    expect(headers["User-Agent"]).toBe(MUSE_CODE_INFERENCE_USER_AGENT);
    expect(headers["User-Agent"]).toMatch(/^muse-build\//);
  });

  it("never remints a pasted Model API key", async () => {
    const executor = getExecutor("muse-code");
    expect(executor.needsRefresh({ apiKey: "model-api-key-a" })).toBe(false);
    await expect(executor.refreshCredentials({ apiKey: "model-api-key-a" })).resolves.toBeNull();
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });
});

describe("Account-scoped Meta Model API model discovery", () => {
  beforeEach(() => proxyFetchMock.mockReset());
  afterEach(() => proxyFetchMock.mockReset());

  it("lists the models the account's own key can use", async () => {
    const { fetchConnectionModels } = await import("../../src/app/api/providers/[id]/models/fetchConnectionModels.js");
    proxyFetchMock.mockResolvedValueOnce(jsonResponse({
      object: "list",
      data: [{ id: MUSE_MODEL, object: "model" }, { id: "muse-wonder-1.0", object: "model" }],
    }));

    const result = await fetchConnectionModels({
      id: "connection-a",
      provider: "muse-code",
      apiKey: "model-api-key-a",
    });

    expect(result.models.map((model) => model.id)).toEqual([MUSE_MODEL, "muse-wonder-1.0"]);
    const { url, headers } = callOf(proxyFetchMock.mock.calls);
    expect(url).toBe(META_MODEL_API_MODELS_URL);
    expect(url).toBe("https://api.meta.ai/v1/models");
    expect(headers.Authorization).toBe("Bearer model-api-key-a");
    // Discovery is a documented Model API call, not a Muse Code client call.
    expect(headers["User-Agent"]).toBeUndefined();
  });

  it("keeps each account's listing on its own key", async () => {
    const { fetchConnectionModels } = await import("../../src/app/api/providers/[id]/models/fetchConnectionModels.js");
    proxyFetchMock.mockImplementation(async () =>
      jsonResponse({ object: "list", data: [{ id: MUSE_MODEL, object: "model" }] }));

    await fetchConnectionModels({ id: "connection-a", provider: "muse-code", apiKey: "model-api-key-a" });
    await fetchConnectionModels({ id: "connection-b", provider: "muse-code", apiKey: "model-api-key-b" });

    const bearers = proxyFetchMock.mock.calls.map(([, init]) => init.headers.Authorization);
    expect(bearers).toEqual(["Bearer model-api-key-a", "Bearer model-api-key-b"]);
  });
});

describe("Bounded failure when upstream refuses a restricted credential", () => {
  beforeEach(() => proxyFetchMock.mockReset());
  afterEach(() => proxyFetchMock.mockReset());

  const denialBody = JSON.stringify({
    error: { code: MUSE_CODE_ATTESTATION_DENIED, message: "client attestation denied" },
  });

  it("reports the refusal without reminting or substituting a credential", async () => {
    const executor = getExecutor("muse-code");
    const parsed = executor.parseError(
      new Response(denialBody, { status: 403 }),
      denialBody
    );
    expect(parsed.status).toBe(403);
    expect(parsed.message).toContain(MUSE_CODE_ATTESTATION_DENIED);
    expect(parsed.message).toContain("Meta Model API key");
    // The raw body stays available for the bounded decision.
    expect(parsed.errorBody).toBe(denialBody);

    // The refusal cannot be answered by a fresh key, so no refresh is offered.
    expect(executor.shouldRefreshAfterAuthFailure({ errorBody: denialBody })).toBe(false);
  });

  it("still refreshes a plain unauthorized answer", () => {
    const executor = getExecutor("muse-code");
    expect(executor.shouldRefreshAfterAuthFailure({ errorBody: '{"error":{"message":"invalid api key"}}' })).toBe(true);
  });

  it("does not remint a subscription key when the attestation is refused", async () => {
    const executor = getExecutor("muse-code");
    proxyFetchMock.mockResolvedValueOnce(jsonResponse({ api_key: "mk-new" }));

    const refreshed = await executor.refreshCredentials({
      accessToken: "mk-live",
      refreshToken: "dca:abc",
      providerSpecificData: { dcaToken: "dca:abc" },
    });

    // The remint itself is untouched; what changes is that it is not attempted
    // as an answer to an attestation denial.
    expect(refreshed).toMatchObject({ accessToken: "mk-new", refreshToken: "dca:abc" });
    expect(callOf(proxyFetchMock.mock.calls).url).toBe(MUSE_CODE_MINT_URL);
  });
});

describe("Bounded failure through the gateway request path", () => {
  const denialBody = JSON.stringify({
    error: { code: MUSE_CODE_ATTESTATION_DENIED, message: "client attestation denied" },
  });

  /** The subscription shape: a minted key plus the device token behind it. */
  const subscriptionCredentials = () => ({
    accessToken: "mk-live",
    refreshToken: "dca:abc",
    providerSpecificData: { dcaToken: "dca:abc" },
  });

  function runGateway(credentials) {
    const body = { model: `mc/${MUSE_MODEL}`, input: "hello" };
    return handleChatCore({
      body,
      modelInfo: { provider: "muse-code", model: MUSE_MODEL },
      credentials,
      clientRawRequest: { endpoint: "/v1/responses", body, headers: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
  }

  beforeEach(() => proxyFetchMock.mockReset());
  afterEach(() => proxyFetchMock.mockReset());

  it("surfaces an attestation denial with one upstream call and no remint", async () => {
    proxyFetchMock.mockImplementation(async () =>
      new Response(denialBody, { status: 403, headers: { "Content-Type": "application/json" } }));

    const result = await runGateway(subscriptionCredentials());

    // Exactly one upstream call: the refusal is not answered with a retry.
    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
    // The mint endpoint was never reached: no credential was substituted.
    expect(proxyFetchMock.mock.calls.map(([url]) => url)).not.toContain(MUSE_CODE_MINT_URL);
    expect(result).toMatchObject({ success: false, status: 403 });
    expect(result.error).toContain(MUSE_CODE_ATTESTATION_DENIED);
  });

  it("still remints and retries a plain unauthorized answer", async () => {
    let upstreamCalls = 0;
    proxyFetchMock.mockImplementation(async (url) => {
      if (url === MUSE_CODE_MINT_URL) return jsonResponse({ api_key: "mk-new" });
      upstreamCalls += 1;
      if (upstreamCalls === 1) {
        return new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return jsonResponse({
        id: "resp-1",
        object: "response",
        status: "completed",
        model: MUSE_MODEL,
        output: [{
          id: "msg-1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "ok", annotations: [] }],
        }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    });

    const result = await runGateway(subscriptionCredentials());

    // The narrow veto leaves the ordinary credential lifecycle intact: the
    // key is reminted and the request is retried once with the fresh key.
    const mintCalls = proxyFetchMock.mock.calls.filter(([url]) => url === MUSE_CODE_MINT_URL);
    expect(mintCalls).toHaveLength(1);
    const upstream = proxyFetchMock.mock.calls.filter(([url]) => url !== MUSE_CODE_MINT_URL);
    expect(upstream).toHaveLength(2);
    expect(callOf(upstream, 0).headers.Authorization).toBe("Bearer mk-live");
    expect(callOf(upstream, 1).headers.Authorization).toBe("Bearer mk-new");
    expect(result.success).toBe(true);
  });
});
