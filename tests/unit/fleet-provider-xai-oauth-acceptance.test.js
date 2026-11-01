/**
 * Scope note (issue #1247, "xai-oauth"): offline acceptance for the installed
 * native `xai` provider (api.x.ai, authModes oauth + apikey). Exercises the
 * existing validator, connection model discovery and chatCore with mocked
 * fetch only. It does NOT prove account-backed behaviour: live OAuth, billing
 * and model availability are unverified. A separate `xai-oauth` provider id is
 * NOT registered in this tree, so it must stay hidden; `grok-cli` (Grok Build
 * proxy) and `grok-web` (web SSO) are distinct identities, not xAI native.
 * Static registry exports below only assert metadata, never runtime support.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub before dependency evaluation, including registry import-time side effects.
vi.hoisted(() => vi.stubGlobal("fetch", vi.fn()));
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: vi.fn(() => "kimchi/0.1.01"),
  updateKimchiUserAgent: vi.fn(async () => "kimchi/0.1.01"),
}));
vi.mock("@/models", () => ({ getProviderNodeById: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { XaiExecutor } from "../../open-sse/executors/xai.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { POST as validate } from "../../src/app/api/providers/validate/route.js";
import { normalizeProviderId } from "../../src/lib/providerNormalization.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import "../translator/registerAll.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

// Keep persistence and request logging outside this transport acceptance scope.
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({
  startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn(),
}));
vi.mock("../../open-sse/utils/requestLogger.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(), logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  proxyAwareFetch.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const validateReq = (body) =>
  new Request("http://localhost/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("xai native: validator (mocked fetch)", () => {
  it.each([
    [200, true],
    [403, true], // valid key without credit
    [400, false], // xAI answers 400 for a bad key
    [401, false],
  ])("status %i => valid=%s via api.x.ai/v1/models with bearer", async (status, valid) => {
    fetch.mockResolvedValueOnce(new Response("{}", { status }));
    const res = await validate(validateReq({ provider: "xai", apiKey: "xai-key" }));
    expect((await res.json()).valid).toBe(valid);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/models");
    expect(init.headers.Authorization).toBe("Bearer xai-key");
  });
});

describe("xai native: model discovery (mocked fetch)", () => {
  it("lists /v1/models with bearer auth and parses OpenAI-style data", async () => {
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ data: [{ id: "grok-4.5" }, { id: "grok-4.3" }] }));
    const connection = { id: "fixture-xai", provider: "xai", accessToken: "fixture-model-token" };
    const result = await fetchConnectionModels(connection);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/models");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer fixture-model-token");
    expect(result.models.map((model) => model.id)).toEqual(["grok-4.5", "grok-4.3"]);
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ error: "x" }));
    expect(await fetchConnectionModels(connection)).toEqual({ models: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("xai native: executor request/tool/stream/error fixtures (mocked fetch)", () => {
  const executor = new XaiExecutor();
  const tools = [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }];
  const oauth = {
    accessToken: "oauth-token",
    runtimeTransport: { format: "openai-responses-oauth", baseUrl: "https://api.x.ai/v1/responses" },
  };

  it("forwards tools on the OAuth Responses transport and returns the SSE stream untouched", async () => {
    const sse = 'event: response.output_text.delta\ndata: {"delta":"hi"}\n\n';
    proxyAwareFetch.mockResolvedValueOnce(
      new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    const { response } = await executor.execute({
      model: "grok-4.5",
      body: { model: "grok-4.5", input: [], tools, stream: true },
      stream: true,
      credentials: oauth,
    });
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(JSON.parse(init.body).tools).toEqual(tools);
    expect(init.headers.Authorization).toBe("Bearer oauth-token");
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(await response.text()).toBe(sse);
  });

  it("surfaces an upstream 401 without faking success", async () => {
    proxyAwareFetch.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
    const { response } = await executor.execute({
      model: "grok-4.5",
      body: { model: "grok-4.5", input: [] },
      stream: false,
      credentials: oauth,
    });
    expect(response.status).toBe(401);
  });

  it("strips reasoning from non-reasoning ids but keeps it on grok-4.3", () => {
    const body = { reasoning_effort: "high" };
    expect(executor.transformRequest("grok-4.20-0309-non-reasoning", { ...body }).reasoning_effort).toBeUndefined();
    expect(executor.transformRequest("grok-4.3", { ...body }).reasoning_effort).toBe("high");
  });
});

describe("xai native: real chatCore transport selection (mocked fetch)", () => {
  it.each(["oauth", "apikey"])("selects %s transport without injected runtimeTransport", async (authType) => {
    const oauth = authType === "oauth";
    const credentials = oauth
      ? { authType, accessToken: "fixture-oauth-token" }
      : { authType, apiKey: "fixture-api-key" };
    const body = { model: "grok-4.5", messages: [{ role: "user", content: "hi" }], stream: false };
    const upstream = oauth
      ? { id: "resp-fixture", object: "response", status: "completed", output: [{
          type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }],
        }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
      : { id: "chat-fixture", object: "chat.completion", choices: [{
          index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop",
        }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    proxyAwareFetch.mockResolvedValueOnce(Response.json(upstream));
    const result = await handleChatCore({
      body,
      modelInfo: { provider: "xai", model: "grok-4.5" },
      credentials,
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
      connectionId: "fixture-xai",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
    });
    expect(result.success).toBe(true);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, init] = proxyAwareFetch.mock.calls[0];
    const wire = JSON.parse(init.body);
    expect(url).toBe(`https://api.x.ai/v1/${oauth ? "responses" : "chat/completions"}`);
    expect(init.headers.Authorization).toBe(`Bearer ${oauth ? "fixture-oauth-token" : "fixture-api-key"}`);
    expect(wire.model).toBe("grok-4.5");
    if (oauth) {
      expect(wire.input).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([expect.objectContaining({ type: "input_text", text: "hi" })]),
        }),
      ]));
      expect(wire.messages).toBeUndefined();
    } else {
      expect(wire.messages).toEqual(body.messages);
      expect(wire.input).toBeUndefined();
    }
    expect(credentials.runtimeTransport).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("candidate identity: xai-oauth is not installed; grok-cli/grok-web are distinct", () => {
  it("native xai declares oauth + apikey on api.x.ai/auth.x.ai (metadata only)", () => {
    expect(PROVIDERS.xai.baseUrl ?? PROVIDERS.xai.transport?.baseUrl).toMatch(/^https:\/\/api\.x\.ai\//);
    expect(PROVIDERS.xai.tokenUrl ?? PROVIDERS.xai.transport?.tokenUrl).toBe("https://auth.x.ai/oauth2/token");
  });

  it("registers no `xai-oauth` provider and normalizes it to itself (unsupported, not aliased to xai)", async () => {
    expect(PROVIDERS["xai-oauth"]).toBeUndefined();
    expect(normalizeProviderId("xai-oauth")).toBe("xai-oauth");
    const res = await validate(validateReq({ provider: "xai-oauth", apiKey: "k" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Provider validation not supported" });
    expect(fetch).not.toHaveBeenCalled();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("rejects unsupported xai-oauth execution with status 400 and ZERO fetches", async () => {
    const onProviderAttempt = vi.fn();
    const executor = getExecutor("xai-oauth");
    const buildHeaders = vi.spyOn(executor, "buildHeaders");
    try {
      await expect(executor.execute({
        model: "grok-4.5",
        body: { model: "grok-4.5", messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { accessToken: "fixture-xai-oauth-token" },
        onProviderAttempt,
      })).rejects.toMatchObject({
        name: "Error",
        message: 'Unknown provider "xai-oauth": no supported transport endpoint',
        status: 400,
      });
      expect(buildHeaders).not.toHaveBeenCalled();
      expect(onProviderAttempt).not.toHaveBeenCalled();
      expect(proxyAwareFetch).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      buildHeaders.mockRestore();
    }
  });

  it("grok-cli and grok-web are separate identities and transports from native xai", () => {
    const xaiUrl = PROVIDERS.xai.baseUrl ?? PROVIDERS.xai.transport?.baseUrl;
    const cli = PROVIDERS["grok-cli"];
    expect(cli).toBeDefined();
    expect(cli.baseUrl ?? cli.transport?.baseUrl).toContain("cli-chat-proxy.grok.com");
    expect(cli.baseUrl ?? cli.transport?.baseUrl).not.toBe(xaiUrl);
    expect(getExecutor("grok-cli")).not.toBe(getExecutor("xai"));
    expect(getExecutor("grok-web")).not.toBe(getExecutor("xai"));
  });
});
