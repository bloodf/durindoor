import { describe, it, expect, vi, beforeEach } from "vitest";
import "../translator/registerAll.js";

// Provider-scoped service-tier suffix (#1072).
//
// Only OpenAI and Codex accept the OpenAI-style `service_tier` request field,
// so only they read `(fast)` / `(standard)` as a tier control. On every other
// provider the same suffix belongs to the opaque model ID and must reach
// dispatch intact — a live or custom model may legitimately end in it.
//
// The gateway entry is the normal chat core; the executor is a synthetic
// double, so no provider, credential or network is involved.

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
  createSSETransformStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  finishActiveSession: vi.fn(),
  startActiveSession: vi.fn(),
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

import { parseModelModifiers, parseSuffix } from "../../open-sse/translator/concerns/thinkingSuffix.js";
import { supportsServiceTier } from "../../open-sse/config/serviceTier.js";

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockImplementation(async () => ({
    response: Response.json({ error: { message: "fixture upstream rejection" } }, { status: 400 }),
    url: "https://example.invalid/chat", headers: {}, transformedBody: null,
  }));
});

/** Dispatch one request through the gateway and return the synthetic executor call. */
async function dispatch(provider, model, extra = {}, sourceFormat = "openai") {
  const request = sourceFormat === "openai-responses"
    ? { input: "hello" }
    : { messages: [{ role: "user", content: "hello" }] };
  await handleChatCore({
    body: { model, max_tokens: 1024, stream: false, ...request, ...extra },
    modelInfo: { provider, model },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    sourceFormatOverride: sourceFormat,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/responses", body: {}, headers: {} },
  });
  expect(executeMock).toHaveBeenCalledOnce();
  return executeMock.mock.calls[0][0];
}

describe("service-tier suffix scope (#1072)", () => {
  describe("providers that accept a service tier", () => {
    it.each(["openai", "codex"])("keeps the tier control on %s", async (provider) => {
      const call = await dispatch(provider, "gpt-6.1-sol(fast)");
      expect(call.model).toBe("gpt-6.1-sol");
      expect(call.body.model).toBe("gpt-6.1-sol");
      expect(call.body.service_tier).toBe("priority");
    });

    it.each(["openai", "codex"])("keeps the standard tier on %s", async (provider) => {
      const call = await dispatch(provider, "gpt-6.1-sol(standard)");
      expect(call.model).toBe("gpt-6.1-sol");
      expect(call.body.service_tier).toBe("default");
    });

    it("keeps a tier combined with a thinking modifier", async () => {
      const call = await dispatch("openai", "gpt-6.1-sol(xhigh,fast)");
      expect(call.model).toBe("gpt-6.1-sol");
      expect(call.body.service_tier).toBe("priority");
      expect(call.body.reasoning?.effort || call.body.reasoning_effort).toBe("xhigh");
    });

    it("lets the explicit tier modifier override the request body", async () => {
      const call = await dispatch("openai", "gpt-6.1-sol(standard)", { service_tier: "priority" });
      expect(call.body.service_tier).toBe("default");
    });
  });

  describe("providers without a service tier", () => {
    it("dispatches a tier-shaped suffix intact", async () => {
      const call = await dispatch("groq", "gpt-6.1-sol(fast)");
      expect(call.model).toBe("gpt-6.1-sol(fast)");
      expect(call.body.model).toBe("gpt-6.1-sol(fast)");
      expect(call.body.service_tier).toBeUndefined();
    });

    it("dispatches a standard suffix intact", async () => {
      const call = await dispatch("groq", "gpt-6.1-sol(standard)");
      expect(call.model).toBe("gpt-6.1-sol(standard)");
      expect(call.body.service_tier).toBeUndefined();
    });

    it("dispatches a tier combined with a thinking modifier intact", async () => {
      const call = await dispatch("groq", "gpt-6.1-sol(xhigh,fast)");
      expect(call.model).toBe("gpt-6.1-sol(xhigh,fast)");
      expect(call.body.model).toBe("gpt-6.1-sol(xhigh,fast)");
      expect(call.body.service_tier).toBeUndefined();
    });

    it("dispatches a custom model id that ends in a tier-shaped suffix intact", async () => {
      const call = await dispatch("groq", "my-custom-model(fast)");
      expect(call.model).toBe("my-custom-model(fast)");
      expect(call.body.model).toBe("my-custom-model(fast)");
      expect(call.body.service_tier).toBeUndefined();
    });

    it("does not rewrite a catalog model through a tier-shaped suffix", async () => {
      const call = await dispatch("groq", "llama-3.3-70b-versatile(fast)");
      expect(call.model).toBe("llama-3.3-70b-versatile(fast)");
      expect(call.body.model).toBe("llama-3.3-70b-versatile(fast)");
      expect(call.body.service_tier).toBeUndefined();
    });

    it("leaves an explicit request-body tier untouched", async () => {
      const call = await dispatch("groq", "gpt-6.1-sol(fast)", { service_tier: "flex" });
      expect(call.body.model).toBe("gpt-6.1-sol(fast)");
      expect(call.body.service_tier).toBe("flex");
    });

    it("still resolves catalog aliases", async () => {
      const call = await dispatch("deepseek", "deepseek-v4-pro-max");
      expect(call.model).toBe("deepseek-v4-pro");
    });

    it("keeps the selected provider account on dispatch", async () => {
      const call = await dispatch("groq", "gpt-6.1-sol(fast)");
      expect(call.credentials?.apiKey).toBe("test-key");
    });
  });

  describe("suffix parsing", () => {
    it("scopes the tier control to the providers that accept one", () => {
      expect(supportsServiceTier("openai")).toBe(true);
      expect(supportsServiceTier("codex")).toBe(true);
      expect(supportsServiceTier("cx")).toBe(true);
      expect(supportsServiceTier("groq")).toBe(false);
      expect(supportsServiceTier("deepseek")).toBe(false);
      expect(supportsServiceTier(undefined)).toBe(false);
    });

    it("selects a tier only for a supporting provider", () => {
      expect(parseModelModifiers("model(fast)", "openai")).toEqual({
        cleanModel: "model", override: null, serviceTier: "priority",
      });
      expect(parseModelModifiers("model(fast)", "groq")).toEqual({
        cleanModel: "model(fast)", override: null, serviceTier: null,
      });
    });

    it("keeps an unsupported provider's suffix opaque in parseSuffix", () => {
      expect(parseSuffix("model(fast)", "groq")).toEqual({
        cleanModel: "model(fast)", override: null,
      });
      expect(parseSuffix("model(8192,fast)", "groq")).toEqual({
        cleanModel: "model(8192,fast)", override: null,
      });
    });

    it("keeps the legacy provider-less parse shape", () => {
      expect(parseSuffix("model(8192,fast)")).toEqual({
        cleanModel: "model", override: { mode: "budget", budget: 8192 },
      });
    });

    it("still parses a thinking modifier for a provider without tier support", () => {
      expect(parseSuffix("model(high)", "groq")).toEqual({
        cleanModel: "model", override: { mode: "level", level: "high" },
      });
    });
  });
});
