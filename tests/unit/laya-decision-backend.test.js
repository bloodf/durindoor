/**
 * Laya: a user-run `laya-serve` speaks Jev's /v1/systemone protocol, so an
 * active Laya connection replaces Jev as the smart/task combo classifier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProviderConnections: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: mocks.getProviderConnections }));

const { classifyTier, resetJevBreaker } = await import("../../open-sse/services/jevClassifier.js");
const { handleComboChat } = await import("../../open-sse/services/combo.js");
const { resolveDecisionBackend, clearLayaDetection } = await import("../../src/sse/services/decisionBackend.js");
const { resolveLayaHost, resolveLayaCheckpoint, LAYA_DEFAULT_HOST } = await import("../../open-sse/config/laya.js");
const { default: REGISTRY } = await import("../../open-sse/providers/registry/index.js");

const log = { info: () => {}, warn: () => {}, debug: () => {} };

// Shape laya-serve returns for a choice question (Agent.predict output).
// `confidence` is Laya's uncalibrated entropy score (far below 0.5 in practice);
// `answer_confidence` is the calibrated max probability the classifier gates on.
function layaOk(choice, answerConfidence = 0.9) {
  const json = {
    model: "laya-rl-agent",
    answers: { tier: { type: "choice", choice, probabilities: { [choice]: answerConfidence }, confidence: 0.08, answer_confidence: answerConfidence } },
    usage: { input_tokens: 120, output_tokens: 0 },
    routing: { model: "english" }
  };
  return { ok: true, status: 200, json: async () => json };
}

beforeEach(() => {
  resetJevBreaker();
  clearLayaDetection();
  mocks.getProviderConnections.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Laya registry entry", () => {
  it("is a keyless-capable System One provider with no chat transport", () => {
    const laya = REGISTRY.find((p) => p.id === "laya");
    expect(laya.apiKeyOptionalWith).toBe("baseUrl");
    expect(laya.serviceKinds).toEqual(["systemone"]);
    expect(laya.systemoneConfig).toMatchObject({ baseUrl: "http://127.0.0.1:8000/v1/systemone", userConfigurableHost: true });
    expect(laya.transport).toBeUndefined();
    expect(laya.models.every((m) => m.kind === "systemone")).toBe(true);
  });
});

describe("resolveLayaHost / resolveLayaCheckpoint", () => {
  it("keeps only the origin of a stored host", () => {
    expect(resolveLayaHost({ providerSpecificData: { baseUrl: "http://10.0.0.5:9000/v1/systemone?x=1" } })).toBe("http://10.0.0.5:9000");
  });
  it("falls back to the default host for blank or non-http values", () => {
    expect(resolveLayaHost(null)).toBe(LAYA_DEFAULT_HOST);
    expect(resolveLayaHost({ providerSpecificData: { baseUrl: "file:///etc/passwd" } })).toBe(LAYA_DEFAULT_HOST);
    expect(resolveLayaHost({ providerSpecificData: { baseUrl: "not a url" } })).toBe(LAYA_DEFAULT_HOST);
  });
  it("pins only known checkpoints, otherwise lets Laya route", () => {
    expect(resolveLayaCheckpoint({ providerSpecificData: { model: "multilingual" } })).toBe("multilingual");
    expect(resolveLayaCheckpoint({ providerSpecificData: { model: "jev-latest" } })).toBeNull();
    expect(resolveLayaCheckpoint({})).toBeNull();
  });
});

describe("resolveDecisionBackend", () => {
  it("returns null with no connection and no local Laya running (Jev env stays in charge)", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await resolveDecisionBackend({ fetchImpl })).toBeNull();
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: "laya", isActive: true });
  });

  it("uses a keyless laya-serve already running on the default host", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    expect(await resolveDecisionBackend({ fetchImpl })).toMatchObject({ source: "laya", baseUrl: LAYA_DEFAULT_HOST, apiKey: null });
    expect(fetchImpl.mock.calls[0][0]).toBe(`${LAYA_DEFAULT_HOST}/v1/systemone`);
  });

  it("does not trust a redirect during detection", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 307, headers: { location: "https://other/v1/systemone" } }));
    expect(await resolveDecisionBackend({ fetchImpl })).toBeNull();
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("manual");
  });

  it("skips a local Laya that demands a key, so it cannot shadow Jev", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    expect(await resolveDecisionBackend({ fetchImpl })).toBeNull();
  });

  it("caches detection for 30 seconds", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    await resolveDecisionBackend({ fetchImpl, now: 1000 });
    await resolveDecisionBackend({ fetchImpl, now: 25_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await resolveDecisionBackend({ fetchImpl, now: 32_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("skips local detection when the outbound guard blocks loopback", async () => {
    vi.stubEnv("OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS", "false");
    mocks.getProviderConnections.mockResolvedValue([]);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    expect(await resolveDecisionBackend({ fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never selects a Laya connection pointing at a blocked host", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ providerSpecificData: { baseUrl: "http://169.254.169.254" } }]);
    expect(await resolveDecisionBackend({ fetchImpl: vi.fn() })).toBeNull();
  });

  it("sends classifier calls through the outbound guard", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ providerSpecificData: { baseUrl: "http://127.0.0.1:8001" } }]);
    const backend = await resolveDecisionBackend({ fetchImpl: vi.fn() });
    expect(typeof backend.fetchImpl).toBe("function");
    await expect(backend.fetchImpl("http://169.254.169.254/v1/systemone", { method: "POST" })).rejects.toThrow();
  });

  it("prefers the user's own Laya connection over a detected local one", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ apiKey: "k", providerSpecificData: { baseUrl: "http://10.0.0.9:8000" } }]);
    const fetchImpl = vi.fn();
    expect((await resolveDecisionBackend({ fetchImpl })).baseUrl).toBe("http://10.0.0.9:8000");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("builds keyless, free, auto-routed Laya settings from the first active connection", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "laya", apiKey: "", providerSpecificData: { baseUrl: "http://127.0.0.1:8001/" } }
    ]);
    expect(await resolveDecisionBackend()).toMatchObject({
      source: "laya",
      baseUrl: "http://127.0.0.1:8001",
      apiKey: null,
      apiKeyOptional: true,
      model: null,
      minConfidence: 0.4,
      inputPricePerMTok: 0,
      outputPricePerMTok: 0
    });
  });
});

describe("classifyTier against Laya", () => {
  it("calls a keyless Laya without a bearer header or model and returns its tier", async () => {
    const fetchImpl = vi.fn(async () => layaOk("COMPLEX"));
    const result = await classifyTier({
      state: "refactor the auth module across services",
      log,
      baseUrl: "http://127.0.0.1:8000",
      apiKey: null,
      apiKeyOptional: true,
      model: null,
      source: "laya",
      inputPricePerMTok: 0,
      outputPricePerMTok: 0,
      fetchImpl
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/v1/systemone");
    expect(init.headers.Authorization).toBeUndefined();
    const payload = JSON.parse(init.body);
    expect(payload.model).toBeUndefined();
    expect(payload.questions.tier.type).toBe("choice");
    expect(result).toMatchObject({ tier: "COMPLEX", source: "laya", spendUsd: 0 });
  });

  it("sends the bearer key when the Laya server requires one", async () => {
    const fetchImpl = vi.fn(async () => layaOk("SIMPLE"));
    await classifyTier({ state: "hi", log, baseUrl: "http://h:1", apiKey: "laya-secret", apiKeyOptional: true, model: "english", fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer laya-secret");
    expect(JSON.parse(init.body).model).toBe("english");
  });

  it("gates on Laya's calibrated answer_confidence, not its entropy score", async () => {
    const opts = { state: "hi", log, baseUrl: "http://h:1", apiKey: null, apiKeyOptional: true, minConfidence: 0.4 };
    expect((await classifyTier({ ...opts, fetchImpl: vi.fn(async () => layaOk("SIMPLE", 0.46)) }))?.confidence).toBe(0.46);
    expect(await classifyTier({ ...opts, fetchImpl: vi.fn(async () => layaOk("SIMPLE", 0.33)) })).toBeNull();
  });

  it("keeps one breaker per host, so a failing Laya does not switch Jev off", async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    expect(await classifyTier({ state: "hi", log, baseUrl: "http://laya:8000", apiKeyOptional: true, fetchImpl: failing })).toBeNull();
    const jev = vi.fn(async () => layaOk("SIMPLE", 0.9));
    expect((await classifyTier({ state: "hi", log, baseUrl: "https://api.typesafe.ai", apiKey: "k", fetchImpl: jev }))?.tier).toBe("SIMPLE");
    const again = vi.fn();
    expect(await classifyTier({ state: "hi", log, baseUrl: "http://laya:8000", apiKeyOptional: true, fetchImpl: again })).toBeNull();
    expect(again).not.toHaveBeenCalled();
  });

  it("does not follow redirects", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 307, json: async () => ({}) }));
    expect(await classifyTier({ state: "hi", log, baseUrl: "http://laya:8000", apiKeyOptional: true, fetchImpl })).toBeNull();
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("manual");
  });

  it("still requires a key for Jev (unchanged default)", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetchImpl = vi.fn();
    expect(await classifyTier({ state: "hi", log, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("handleComboChat with a Laya backend", () => {
  async function runSmartCombo(decisionBackend) {
    const fetchSpy = vi.fn(async () => layaOk("REASONING", 0.95));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const order = [];
    await handleComboChat({
      body: { messages: [{ role: "user", content: "prove this lock-free queue is linearizable" }] },
      models: ["a/one", "b/two"],
      handleSingleModel: async (_b, m) => { order.push(m); return new Response("ok", { status: 200 }); },
      log,
      comboName: "smart-combo",
      comboStrategy: "smart",
      jevClassify: true,
      decisionBackend
    });
    return fetchSpy;
  }

  it("asks the Laya host even with no Jev key configured", async () => {
    const fetchSpy = await runSmartCombo(async () => ({
      source: "laya", baseUrl: "http://127.0.0.1:8000", apiKey: null, apiKeyOptional: true, model: null
    }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://127.0.0.1:8000/v1/systemone");
  });

  it("falls back to the Jev env config when no Laya backend resolves", async () => {
    const fetchSpy = vi.fn(async () => layaOk("MEDIUM", 0.9));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test-key");
    await handleComboChat({
      body: { messages: [{ role: "user", content: "fix the pagination bug" }] },
      models: ["a/one", "b/two"],
      handleSingleModel: async () => new Response("ok", { status: 200 }),
      log,
      comboName: "smart-combo",
      comboStrategy: "smart",
      jevClassify: true,
      decisionBackend: async () => null
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers.Authorization).toBe("Bearer ts-test-key");
  });

  it("with neither Laya nor a Jev key, the classifier stays off", async () => {
    const fetchSpy = await runSmartCombo(async () => null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a failing backend resolver fails open to the Jev env config", async () => {
    const fetchSpy = vi.fn(async () => layaOk("MEDIUM", 0.9));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test-key");
    await handleComboChat({
      body: { messages: [{ role: "user", content: "fix the pagination bug" }] },
      models: ["a/one", "b/two"],
      handleSingleModel: async () => new Response("ok", { status: 200 }),
      log,
      comboName: "smart-combo",
      comboStrategy: "smart",
      jevClassify: true,
      decisionBackend: async () => { throw new Error("db down"); }
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers.Authorization).toBe("Bearer ts-test-key");
  });
});
