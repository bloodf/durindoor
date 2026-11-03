import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import handoff from "../../open-sse/handlers/nativeRealtimeHandoff.cjs";

const previousControlSecret = process.env.DURINDOOR_CONTROL_PROOF_SECRET;
const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(), getApiKeyByKey: vi.fn(), getApiKeyUsageLimitStatus: vi.fn(), saveRequestUsage: vi.fn(),
  resolveClientApiKey: vi.fn(), getProviderCredentialsWithQuotaPreflight: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(), getModelInfo: vi.fn(), registry: [],
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, getApiKeyByKey: mocks.getApiKeyByKey, getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus, saveRequestUsage: mocks.saveRequestUsage }));
vi.mock("@/sse/services/auth", () => ({ resolveClientApiKey: mocks.resolveClientApiKey, getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentialsWithQuotaPreflight }));
vi.mock("@/sse/services/apiKeyPolicy", async (importOriginal) => ({ ...await importOriginal(), enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy }));
vi.mock("@/sse/services/model", () => ({ getModelInfo: mocks.getModelInfo }));
vi.mock("open-sse/config/providerModels", () => ({ PROVIDER_ID_TO_ALIAS: {}, getModelQuotaFamily: vi.fn(), getModelUpstreamId: (_provider, model) => model }));
vi.mock("open-sse/providers/registry/index.js", () => ({ default: mocks.registry }));

const require = createRequire(import.meta.url);
const { createControlProof, createRealtimeOperatorProof, verifyRealtimeOperatorProof } = require("../../src/mitm/controlProof.js");
const { POST } = await import("../../src/app/api/v1/realtime/native/route.js");

function request(headers = {}, body = { model: "openai/gpt-realtime-2.1", path: "/v1/realtime" }) {
  return new Request("http://localhost/api/v1/realtime/native", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("native realtime credential boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DURINDOOR_CONTROL_PROOF_SECRET = "a".repeat(64);
    mocks.registry.length = 0;
    mocks.registry.push({ id: "openai", models: [{ id: "gpt-realtime-2.1", kind: "realtime" }], realtimeConfig: {
      authScheme: "Bearer", protocols: { realtime: { wsUrl: "wss://api.openai.com/v1/realtime", modelInQuery: true } }
    } });
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.resolveClientApiKey.mockResolvedValue({ apiKey: "gateway-key", auth: { ok: true, apiKeyId: "gateway", billingEpoch: "epoch-before-import" } });
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-realtime-2.1" });
    mocks.getApiKeyByKey.mockResolvedValue(null);
    mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false });
    mocks.saveRequestUsage.mockResolvedValue(true);
    mocks.getProviderCredentialsWithQuotaPreflight.mockResolvedValue({ connectionId: "conn-a", apiKey: "private-provider-secret", providerSpecificData: {
      connectionProxyEnabled: true, connectionProxyUrl: "http://user:private-proxy-secret@127.0.0.1:9000", strictProxy: true, disableEnvProxy: true
    } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (previousControlSecret === undefined) delete process.env.DURINDOOR_CONTROL_PROOF_SECRET;
    else process.env.DURINDOOR_CONTROL_PROOF_SECRET = previousControlSecret;
  });

  it("fails closed before credential resolution without valid owner proof", async () => {
    const result = await POST(request({ "x-9r-owner-port": "43210", "x-9r-owner-proof": "0".repeat(64) }));
    expect(result.status).toBe(404);
    expect(mocks.resolveClientApiKey).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentialsWithQuotaPreflight).not.toHaveBeenCalled();
  });

  it("binds operator proof to model, path, and expiry", () => {
    const expiresAt = Date.now() + 1_000;
    const proof = createRealtimeOperatorProof({ model: "openai/gpt-realtime-2.1", path: "/v1/realtime", expiresAt });
    expect(createControlProof({ method: "POST", pathname: "/api/v1/realtime/native", remotePort: 43210 })).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyRealtimeOperatorProof({ proof, model: "openai/gpt-realtime-2.1", path: "/v1/realtime", expiresAt })).toBe(true);
    expect(verifyRealtimeOperatorProof({ proof, model: "openai/gpt-live-1", path: "/v1/realtime", expiresAt })).toBe(false);
    expect(verifyRealtimeOperatorProof({ proof, model: "openai/gpt-realtime-2.1", path: "/v1/live/sessions", expiresAt })).toBe(false);
    expect(verifyRealtimeOperatorProof({ proof, model: "openai/gpt-realtime-2.1", path: "/v1/realtime", expiresAt: Date.now() - 1 })).toBe(false);
  });

  it("keeps Gemini credentials private and records each generation even when later usage is smaller", async () => {
    mocks.registry.length = 0;
    mocks.registry.push({ id: "gemini", models: [{ id: "gemini-3.8-live", kind: "live" }] });
    mocks.getModelInfo.mockResolvedValue({ provider: "gemini", model: "gemini-3.8-live" });
    const admission = { ok: true, apiKeyId: "gateway", billingEpoch: "epoch-before-import" };
    mocks.resolveClientApiKey.mockResolvedValue({ apiKey: "gateway-key", auth: admission });
    const credentials = await mocks.getProviderCredentialsWithQuotaPreflight();
    mocks.getProviderCredentialsWithQuotaPreflight.mockImplementation(async () => {
      admission.billingEpoch = "epoch-after-import";
      return credentials;
    });
    const proof = createControlProof({ method: "POST", pathname: "/api/v1/realtime/native", remotePort: 43210 });
    const result = await POST(request({ "x-9r-owner-port": "43210", "x-9r-owner-proof": proof, "x-9r-realtime-client-key": "gateway-key" }, { model: "gemini/gemini-3.8-live", path: "/v1/native/gemini/live", connectionId: "conn-a" }));
    const payload = await result.clone().json();
    const { handoffId } = payload;
    expect(Object.keys(payload)).toEqual(["handoffId"]);
    expect(await result.text()).not.toContain("private-provider-secret");
    const prepared = handoff.consumeNativeRealtimeHandoff(handoffId);
    expect(new URL(prepared.wsUrl).searchParams.getAll("key")).toEqual(["private-provider-secret"]);
    expect(prepared).toMatchObject({ authorization: null, queryAuthParameter: "key", pinnedModel: "gemini-3.8-live", geminiLive: true });
    await prepared.onProviderEvent({ usageMetadata: { promptTokenCount: 3, responseTokenCount: 2, totalTokenCount: 5 } });
    await prepared.onProviderEvent({ serverContent: { turnComplete: true } });
    await prepared.onProviderEvent({ usageMetadata: { promptTokenCount: 2, responseTokenCount: 1, totalTokenCount: 3 }, serverContent: { turnComplete: true } });
    await prepared.onProviderEvent({ serverContent: { turnComplete: true } });
    expect(mocks.saveRequestUsage.mock.calls.map(([entry]) => entry.tokens)).toEqual([
      expect.objectContaining({ input_tokens: 3, output_tokens: 2, total_tokens: 5 }),
      expect.objectContaining({ input_tokens: 2, output_tokens: 1, total_tokens: 3 }),
    ]);
    expect(mocks.saveRequestUsage.mock.calls.map(([entry]) => entry.billingEpoch)).toEqual([
      "epoch-before-import", "epoch-before-import",
    ]);
  });

  it("deduplicates interrupted completion and resets usage before the next generation", async () => {
    mocks.registry.length = 0;
    mocks.registry.push({ id: "gemini", models: [{ id: "gemini-3.8-live", kind: "live" }] });
    mocks.getModelInfo.mockResolvedValue({ provider: "gemini", model: "gemini-3.8-live" });
    const proof = createControlProof({ method: "POST", pathname: "/api/v1/realtime/native", remotePort: 43210 });
    const result = await POST(request({ "x-9r-owner-port": "43210", "x-9r-owner-proof": proof }, { model: "gemini/gemini-3.8-live", path: "/v1/native/gemini/live" }));
    const prepared = handoff.consumeNativeRealtimeHandoff((await result.json()).handoffId);
    const first = { promptTokenCount: 10, responseTokenCount: 5, totalTokenCount: 15 };
    await prepared.onProviderEvent({ usageMetadata: first, serverContent: { interrupted: true } });
    await prepared.onProviderEvent({ usageMetadata: first, serverContent: { turnComplete: true } });
    await prepared.onProviderEvent({ usageMetadata: { promptTokenCount: 1, responseTokenCount: 1, totalTokenCount: 2 }, serverContent: { turnComplete: true } });
    await prepared.onProviderClose();
    expect(mocks.saveRequestUsage.mock.calls.map(([entry]) => entry.tokens.total_tokens)).toEqual([15, 2]);
    const identities = mocks.saveRequestUsage.mock.calls.map(([entry]) => entry.usageEventId);
    expect(new Set(identities).size).toBe(2);
  });

  it("returns only an opaque single-use handoff, never provider or proxy credentials", async () => {
    const proof = createControlProof({ method: "POST", pathname: "/api/v1/realtime/native", remotePort: 43210 });
    const result = await POST(request({ "x-9r-owner-port": "43210", "x-9r-owner-proof": proof, "x-9r-realtime-client-key": "gateway-key" }));
    expect(result.status).toBe(200);
    const text = await result.text();
    expect(text).not.toContain("private-provider-secret");
    expect(text).not.toContain("private-proxy-secret");
    const body = JSON.parse(text);
    expect(Object.keys(body)).toEqual(["handoffId"]);
    expect(body.handoffId).toMatch(/^[a-f0-9]{64}$/);
    const prepared = handoff.consumeNativeRealtimeHandoff(body.handoffId);
    expect(prepared.authorization).toBe(["Bearer", "private-provider-secret"].join(" "));
    expect(prepared.wsUrl).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1");
    expect(handoff.consumeNativeRealtimeHandoff(body.handoffId)).toBeNull();
  });

  it("rejects an expired handoff even before its cleanup timer runs", () => {
    const id = handoff.createNativeRealtimeHandoff({ marker: "expired-fixture" });
    const afterExpiry = Date.now() + 10001;
    vi.spyOn(Date, "now").mockReturnValue(afterExpiry);
    expect(handoff.consumeNativeRealtimeHandoff(id)).toBeNull();
  });


  it("uses canonical ACL without RPM for authorizeModel callbacks", async () => {
    const proof = createControlProof({ method: "POST", pathname: "/api/v1/realtime/native", remotePort: 43210 });
    const result = await POST(request({ "x-9r-owner-port": "43210", "x-9r-owner-proof": proof, "x-9r-realtime-client-key": "gateway-key" }, { model: "openai/gpt-realtime-2.1", path: "/v1/realtime", authorizeModel: "gpt-realtime-2.1" }));
    expect(result.status).toBe(204);
    expect(mocks.enforceApiKeyModelPolicy).toHaveBeenCalledWith(expect.any(Request), "openai/gpt-realtime-2.1", "gateway-key", { limits: false });
  });

  it("records each billable response once, preserving token components and unknown cost", async () => {
    const proof = createControlProof({ method: "POST", pathname: "/api/v1/realtime/native", remotePort: 43210 });
    const result = await POST(request({ "x-9r-owner-port": "43210", "x-9r-owner-proof": proof, "x-9r-realtime-client-key": "gateway-key" }));
    const prepared = handoff.consumeNativeRealtimeHandoff((await result.json()).handoffId);
    await prepared.onProviderEvent({ type: "session.created", session: { id: "session-a" } });
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    const usage = { input_tokens: 3, output_tokens: 5, input_tokens_details: { cached_tokens: 2, audio_tokens: 1 }, output_tokens_details: { reasoning_tokens: 2 } };
    const event = { type: "response.completed", response: { id: "resp-a", usage } };
    expect(await prepared.onProviderEvent(event)).toBe(true);
    await prepared.onProviderEvent(event);
    await prepared.onProviderEvent({ ...event, response: { id: "resp-b", usage } });
    expect(mocks.saveRequestUsage.mock.calls.map(([entry]) => entry.usageEventId)).toEqual([
      "openai:conn-a:resp-a:terminal", "openai:conn-a:resp-b:terminal",
    ]);
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "gateway-key", provider: "openai", model: "gpt-realtime-2.1", connectionId: "conn-a",
      endpoint: "/v1/realtime", modality: "realtime", tokens: usage, nativeUnits: {},
      billingEpoch: "epoch-before-import",
      cost: null, costStatus: "unknown", costSource: "provider-cost-unavailable",
    }));
    await expect(prepared.onProviderEvent({ type: "response.completed", id: "session-a", usage })).rejects.toThrow("billable response ID");
  });

  it("settles interrupted Gemini usage once on close with all reported components", async () => {
    mocks.registry.length = 0;
    mocks.registry.push({ id: "gemini", models: [{ id: "gemini-3.8-live", kind: "live" }] });
    mocks.getModelInfo.mockResolvedValue({ provider: "gemini", model: "gemini-3.8-live" });
    const proof = createControlProof({ method: "POST", pathname: "/api/v1/realtime/native", remotePort: 43210 });
    const result = await POST(request({ "x-9r-owner-port": "43210", "x-9r-owner-proof": proof }, { model: "gemini/gemini-3.8-live", path: "/v1/native/gemini/live" }));
    const prepared = handoff.consumeNativeRealtimeHandoff((await result.json()).handoffId);
    const usage = { promptTokenCount: 5, responseTokenCount: 2, totalTokenCount: 7, thoughtsTokenCount: 1, input_tokens_details: { cached_tokens: 4 } };
    await prepared.onProviderEvent({ usageMetadata: usage, serverContent: { interrupted: true } });
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    await prepared.onProviderClose();
    await prepared.onProviderClose();
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      tokens: { ...usage, input_tokens: 5, output_tokens: 2, total_tokens: 7 },
      billingEpoch: "epoch-before-import",
    }));
  });

  it.each([null, "epoch-before-import"])("rejects late realtime usage after import from epoch %s", async (billingEpoch) => {
    mocks.resolveClientApiKey.mockResolvedValue({ apiKey: "gateway-key", auth: { ok: true, apiKeyId: "gateway", billingEpoch } });
    const proof = createControlProof({ method: "POST", pathname: "/api/v1/realtime/native", remotePort: 43210 });
    const result = await POST(request({ "x-9r-owner-port": "43210", "x-9r-owner-proof": proof, "x-9r-realtime-client-key": "gateway-key" }));
    const { handoffId } = await result.json();
    const prepared = handoff.consumeNativeRealtimeHandoff(handoffId);
    mocks.saveRequestUsage.mockRejectedValueOnce(new Error("Stale or missing billing epoch"));
    await expect(prepared.onProviderEvent({ type: "response.completed", response: { id: "resp-fail", usage: { input_tokens: 1, output_tokens: 1 } } })).rejects.toThrow("Stale or missing billing epoch");
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ billingEpoch }));
  });

  it("stops realtime relay after daily limit becomes exhausted", async () => {
    mocks.getApiKeyUsageLimitStatus.mockResolvedValueOnce({ exceeded: false }).mockResolvedValueOnce({ exceeded: true });
    const proof = createControlProof({ method: "POST", pathname: "/api/v1/realtime/native", remotePort: 43210 });
    const result = await POST(request({ "x-9r-owner-port": "43210", "x-9r-owner-proof": proof, "x-9r-realtime-client-key": "gateway-key" }));
    const { handoffId } = await result.json();
    const prepared = handoff.consumeNativeRealtimeHandoff(handoffId);
    expect(await prepared.onProviderEvent({ type: "response.completed", response: { id: "resp-limit", usage: { input_tokens: 1, output_tokens: 1 } } })).toBe(false);
  });
});