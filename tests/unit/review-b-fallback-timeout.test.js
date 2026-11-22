import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chatMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getComboByName: vi.fn(),
  getComboModels: vi.fn(),
  getComboCanonicalName: vi.fn(),
  extractApiKey: vi.fn(),
  getModelInfo: vi.fn(),
  evaluateApiKeyAuth: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(),
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));

vi.mock("open-sse/config/runtimeConfig.js", async (importOriginal) => ({
  ...(await importOriginal()),
  COMBO_MODEL_TIMEOUT_MS: 30000,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: chatMocks.getSettings,
  updateSettings: vi.fn(async (updates) => updates),
  updateSettingsWithPasswordEpoch: vi.fn(),
  PasswordEpochMismatchError: class PasswordEpochMismatchError extends Error {},
  getApiKeyByKey: chatMocks.getApiKeyByKey,
  getApiKeyUsageLimitStatus: chatMocks.getApiKeyUsageLimitStatus,
  getComboByName: chatMocks.getComboByName,
  getComboForModel: vi.fn(async () => null),
}));

vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: chatMocks.getComboModels,
  getComboCanonicalName: chatMocks.getComboCanonicalName,
  getModelInfo: chatMocks.getModelInfo,
  loadCustomCapabilities: async () => null,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: chatMocks.extractApiKey,
  evaluateApiKeyAuth: chatMocks.evaluateApiKeyAuth,
  resolveClientApiKey: async (request, options) => ({
    apiKey: chatMocks.extractApiKey(request),
    auth: await chatMocks.evaluateApiKeyAuth(chatMocks.extractApiKey(request), { ...options, request }),
  }),
  isValidApiKey: vi.fn(async () => true),
  getProviderCredentials: vi.fn(),
  getProviderCredentialsWithQuotaPreflight: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
}));

vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: chatMocks.enforceApiKeyModelPolicy,
  isModelAllowed: vi.fn(() => true),
  recordApiKeyUsage: vi.fn(),
  recordApiKeyUsageForResponse: vi.fn(),
}));

vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: chatMocks.handleComboChat,
  handleFusionChat: chatMocks.handleFusionChat,
  getComboModelQuotaHealth: vi.fn(),
  getFusionRequiredInput: vi.fn(() => null),
  comboPolicyRejection: vi.fn(),
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: vi.fn(),
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200, headers: init.headers }) },
}));
vi.mock("@/lib/settings/settingsPatchAuth", () => ({
  AUTH_CRITICAL_SETTING_KEYS: ["comboPrompts"],
  SECRET_SETTING_KEYS: [],
  canModifySecurityCriticalSettings: async () => true,
  stripSettingKeys: (body, keys) => keys.forEach((key) => delete body[key]),
}));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: async () => true }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));


import {
  getModelFallbacks,
  resetRoundrobinCursors,
  runWithModelFallback,
} from "../../open-sse/services/modelFallback.js";

const fallbacksFor = (primary, models) => ({
  [primary]: { enabled: true, strategy: "ordered", fallbacks: models },
});

function delayedTextResponse(status, text, delayMs) {
  const stream = new ReadableStream({
    async start(controller) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/plain" } });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("runWithModelFallback chain policy (#2265)", () => {
  it("stops on a slow request-scoped context error instead of racing the body", async () => {
    const calls = [];
    const result = await runWithModelFallback(
      "openai/primary",
      fallbacksFor("openai/primary", ["openai/backup"]),
      async (model) => {
        calls.push(model);
        if (model === "openai/primary") {
          return delayedTextResponse(400, "maximum context length exceeded", 350);
        }
        return jsonResponse(200, { ok: true });
      },
      { warn: vi.fn(), error: vi.fn() }
    );

    expect(calls).toEqual(["openai/primary"]);
    expect(result.status).toBe(400);
    expect(await result.text()).toContain("maximum context");
  });

  it("stops on a slow wrong-model body that the 200ms race used to treat as empty", async () => {
    const calls = [];
    const result = await runWithModelFallback(
      "openai/primary",
      fallbacksFor("openai/primary", ["openai/backup"]),
      async (model) => {
        calls.push(model);
        return delayedTextResponse(400, "model not found", 350);
      },
      { warn: vi.fn(), error: vi.fn() }
    );

    expect(calls).toEqual(["openai/primary"]);
    expect(result.status).toBe(400);
  });

  it("stops on terminal billing even though the status would otherwise rotate", async () => {
    const calls = [];
    const result = await runWithModelFallback(
      "openai/primary",
      fallbacksFor("openai/primary", ["other/backup"]),
      async (model) => {
        calls.push(model);
        return jsonResponse(402, { error: { message: "Payment required" } });
      },
      { warn: vi.fn(), error: vi.fn() }
    );

    expect(calls).toEqual(["openai/primary"]);
    expect(result.status).toBe(402);
  });

  it("stops on HTTP 413, which checkFallbackError marks non-fallback", async () => {
    const calls = [];
    await runWithModelFallback(
      "openai/primary",
      fallbacksFor("openai/primary", ["openai/backup"]),
      async (model) => {
        calls.push(model);
        return jsonResponse(413, { error: { message: "Context length exceeded" } });
      },
      { warn: vi.fn(), error: vi.fn() }
    );
    expect(calls).toEqual(["openai/primary"]);
  });

  it("still hops on a slow rate-limit body, so the full text is what decides", async () => {
    const calls = [];
    const result = await runWithModelFallback(
      "openai/primary",
      fallbacksFor("openai/primary", ["openai/backup"]),
      async (model) => {
        calls.push(model);
        if (model === "openai/primary") return delayedTextResponse(400, "rate limit exceeded", 350);
        return jsonResponse(200, { ok: true });
      },
      { warn: vi.fn(), error: vi.fn() }
    );

    expect(calls).toEqual(["openai/primary", "openai/backup"]);
    expect(result.status).toBe(200);
  });

  it("logs and propagates a fallback runner exception", async () => {
    const calls = [];
    const log = { warn: vi.fn(), error: vi.fn() };
    await expect(runWithModelFallback(
      "openai/primary",
      fallbacksFor("openai/primary", ["openai/backup", "openai/third"]),
      async (model) => {
        calls.push(model);
        if (model === "openai/primary") return jsonResponse(503, { error: { message: "unavailable" } });
        throw new Error("runner blew up");
      },
      log
    )).rejects.toThrow("runner blew up");

    expect(calls).toEqual(["openai/primary", "openai/backup"]);
    expect(log.error).toHaveBeenCalled();
  });
});

describe("combo timeoutMs 0 (#2265)", () => {
  const API_KEY = "sk-test-key";

  function makeRequest(model = "combo-privileged") {
    return new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hello" }],
      }),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    chatMocks.extractApiKey.mockReturnValue(API_KEY);
    chatMocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true });
    chatMocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false, usedTokens: 0, limitTokens: 0 });
    chatMocks.enforceApiKeyModelPolicy.mockResolvedValue(null);
    chatMocks.getApiKeyByKey.mockResolvedValue({ name: "granted-key", allowedCombos: [] });
    chatMocks.getComboByName.mockResolvedValue(null);
    chatMocks.getComboModels.mockImplementation(async (model) => (
      String(model).toLowerCase() === "combo-privileged" ? ["prov/model-a", "prov/model-b"] : null
    ));
    chatMocks.getComboCanonicalName.mockImplementation(async (model) => (
      String(model).toLowerCase() === "combo-privileged" ? "Combo-Privileged" : model
    ));
    chatMocks.getModelInfo.mockImplementation(async (modelStr) => {
      if (modelStr === "inner-combo") return { provider: null, model: null };
      const [provider, model] = String(modelStr).split("/");
      return provider && model ? { provider, model } : { provider: null, model: null };
    });
    chatMocks.handleComboChat.mockResolvedValue(new Response("ok", { status: 200 }));
    chatMocks.handleFusionChat.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("lets a per-combo timeoutMs of 0 override COMBO_MODEL_TIMEOUT_MS at both chat call sites", async () => {
    chatMocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategies: {
        "Combo-Privileged": { timeoutMs: 0, fallbackStrategy: "fallback" },
        "inner-combo": { timeoutMs: 0, fallbackStrategy: "fallback" },
      },
    });

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const response = await handleChat(makeRequest("combo-privileged"));
    expect(response.status).toBe(200);
    expect(chatMocks.handleComboChat).toHaveBeenCalledWith(expect.objectContaining({
      comboName: "Combo-Privileged",
      comboTimeoutMs: 0,
    }));

    chatMocks.getComboModels.mockImplementation(async (model) => (
      model === "inner-combo" ? ["prov/inner-a", "prov/inner-b"] : null
    ));
    const handleSingleModel = chatMocks.handleComboChat.mock.calls[0][0].handleSingleModel;
    await handleSingleModel({ messages: [{ role: "user", content: "hello" }] }, "inner-combo");
    expect(chatMocks.handleComboChat).toHaveBeenLastCalledWith(expect.objectContaining({
      comboName: "inner-combo",
      comboTimeoutMs: 0,
    }));
  });

  it("uses the env default when the combo omits timeoutMs, and keeps an explicit positive value", async () => {
    const { handleChat } = await import("../../src/sse/handlers/chat.js");

    chatMocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategies: { "Combo-Privileged": { fallbackStrategy: "fallback" } },
    });
    await handleChat(makeRequest("combo-privileged"));
    expect(chatMocks.handleComboChat).toHaveBeenLastCalledWith(expect.objectContaining({
      comboTimeoutMs: 30000,
    }));

    chatMocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategies: { "Combo-Privileged": { timeoutMs: 1500, fallbackStrategy: "fallback" } },
    });
    await handleChat(makeRequest("combo-privileged"));
    expect(chatMocks.handleComboChat).toHaveBeenLastCalledWith(expect.objectContaining({
      comboTimeoutMs: 1500,
    }));
  });

  it("documents 0 as no combo timer", () => {
    const docs = readFileSync(new URL("../../docs/features/combos.mdx", import.meta.url), "utf8");
    expect(docs).toContain("0 means no combo timer");
    expect(docs).not.toMatch(/0 means use the fetch connect timeout/);
  });
});

describe("round-robin cursor reset when modelFallbacks are saved (#2265)", () => {
  const roundRobin = {
    primary: { enabled: true, strategy: "roundrobin", fallbacks: ["m1", "m2", "m3"] },
  };

  beforeEach(() => {
    resetRoundrobinCursors();
  });

  it("clears cursors after a modelFallbacks settings write and leaves other writes alone", async () => {
    expect(getModelFallbacks("primary", roundRobin)[0]).toBe("m1");

    const { PATCH } = await import("../../src/app/api/settings/route.js");
    const unrelated = await PATCH({ json: async () => ({ enableSessionCapture: false }) });
    expect(unrelated.status).toBe(200);
    expect(getModelFallbacks("primary", roundRobin)[0]).toBe("m2");

    const saved = await PATCH({ json: async () => ({ modelFallbacks: roundRobin }) });
    expect(saved.status).toBe(200);
    expect(getModelFallbacks("primary", roundRobin)[0]).toBe("m1");
  });
});
