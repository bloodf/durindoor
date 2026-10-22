import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), save: vi.fn(), credentials: vi.fn(), policy: vi.fn(),
  resolve: vi.fn(), jobs: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({}), saveRequestUsage: mocks.save,
  getApiKeyByKey: vi.fn(), getApiKeyUsageTotals: vi.fn(), getApiKeyById: vi.fn(),
  getProviderConnectionById: vi.fn(), getApiKeyProviderConnectionIds: vi.fn(),
}));
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({
  createMediaJob: mocks.jobs, getMediaJob: mocks.jobs, finishMediaJob: mocks.jobs,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  resolveClientApiKey: mocks.resolve, getProviderCredentialsWithQuotaPreflight: mocks.credentials,
  markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
  extractApiKey: vi.fn(), hasValidCliToken: vi.fn(),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", async (importOriginal) => ({
  ...await importOriginal(), enforceApiKeyModelPolicy: mocks.policy,
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async (id) => { const [provider, model] = id.split("/"); return { provider, model }; },
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(), checkAndRefreshToken: vi.fn(),
}));
vi.mock("../../src/sse/services/nativeUsage.js", () => ({ nativeUsageFromValue: vi.fn() }));
vi.mock("../../src/sse/utils/logger.js", () => ({ warn: vi.fn() }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ execute: mocks.execute }) }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: async ({ body, models, handleSingleModel }) => {
    let response;
    for (const model of models) {
      response = await handleSingleModel(body, model);
      if (response.ok) return response;
    }
    return response;
  },
}));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: (model) => !model,
  resolveMediaRoute: async () => ({ models: ["veoaifree-web/failed", "veoaifree-web/veo"] }),
  defaultRouteComboOptions: () => ({ comboName: "media-route:video" }),
  listMediaRouteCandidates: vi.fn(), providerOfModelId: vi.fn(), supportsVideoJobs: vi.fn(),
}));

import { handleVideoGeneration } from "../../src/sse/handlers/video.js";
import { getRequestId } from "../../src/sse/utils/requestCorrelation.js";

const body = { model: "veoaifree-web/veo", prompt: "Ocean waves", duration: 99 };
const request = (value = body) => new Request("http://localhost/v1/video/generations", {
  method: "POST", headers: { "content-type": "application/json", "x-request-id": "client-reused-id" },
  body: JSON.stringify(value),
});
const output = { object: "video.generation", data: [{ url: "https://example.com/video.mp4", type: "video" }], status: "completed" };
const success = (value = output) => ({ response: Response.json(value, { headers: { "x-provider-receipt": "preserved" } }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockImplementation(async () => success());
  mocks.save.mockResolvedValue(true);
  mocks.credentials.mockResolvedValue({ connectionId: "account-a", apiKey: "provider-secret" });
  mocks.resolve.mockResolvedValue({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "caller-id" } });
  mocks.policy.mockResolvedValue(null);
});

describe("direct video usage through real core and event validation", () => {
  it("records one unknown-cost event without inventing prompt tokens or requested duration", async () => {
    const req = request();
    const response = await handleVideoGeneration(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-provider-receipt")).toBe("preserved");
    expect(await response.json()).toEqual(output);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      usageEventId: `${getRequestId(req)}:/v1/video/generations`, apiKey: "caller-key",
      provider: "veoaifree-web", model: "veo", connectionId: "account-a",
      endpoint: "/v1/video/generations", modality: "video", tokens: {}, nativeUnits: {},
      cost: null, costStatus: "unknown", costSource: "unavailable", status: "ok", strict: true,
    });
    expect(mocks.credentials).toHaveBeenCalledWith("veoaifree-web", null, "veo", { apiKeyId: "caller-id" });
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it.each([0, 0.27])("keeps provider USD receipt %s and measured duration", async (cost) => {
    const usage = { total_tokens: 12, cost_usd: cost };
    mocks.execute.mockResolvedValue(success({ ...output, usage, video: { duration: "4.5" } }));
    const response = await handleVideoGeneration(request());
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      tokens: { total_tokens: 12 }, nativeUnits: { videoSeconds: 4.5 },
      cost, costStatus: "known", costSource: "provider",
      meta: { providerUsage: { path: "usage", value: usage } },
    });
    expect(mocks.save.mock.calls[0][0].tokens.input_tokens).toBeUndefined();
    expect(mocks.save.mock.calls[0][0].tokens.output_tokens).toBeUndefined();
  });

  it("reuses logical identity but never trusts reused client IDs across requests or callers", async () => {
    const req = request();
    vi.spyOn(req, "json").mockResolvedValue(body);
    await handleVideoGeneration(req);
    await handleVideoGeneration(req);
    mocks.resolve.mockResolvedValue({ apiKey: "other-key", auth: { ok: true, apiKeyId: "other-id" } });
    await handleVideoGeneration(request());
    const events = mocks.save.mock.calls.map(([event]) => event);
    expect(events[0].usageEventId).toBe(events[1].usageEventId);
    expect(events[2].usageEventId).not.toBe(events[0].usageEventId);
    expect(events[2].apiKey).toBe("other-key");
  });

  it("records credential-free execution with explicit null connection", async () => {
    mocks.credentials.mockResolvedValue({});
    expect((await handleVideoGeneration(request())).status).toBe(200);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ connectionId: null, cost: null });
  });

  it("does not record policy denials, validation failures, upstream failures, or thrown executor errors", async () => {
    mocks.policy.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    expect((await handleVideoGeneration(request())).status).toBe(403);
    expect((await handleVideoGeneration(request({ ...body, prompt: "" }))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.execute.mockResolvedValueOnce({ response: Response.json({ error: { message: "unavailable" } }, { status: 503 }) });
    expect((await handleVideoGeneration(request())).status).toBe(503);
    mocks.execute.mockRejectedValueOnce(new Error("transport failed"));
    expect((await handleVideoGeneration(request())).status).toBe(502);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("records only the successful default-route member", async () => {
    mocks.execute.mockResolvedValueOnce({ response: new Response("unavailable", { status: 503 }) });
    expect((await handleVideoGeneration(request({ prompt: "Ocean waves" }))).status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ model: "veo", comboId: null, comboName: "media-route:video" });
  });

  it("does not return success when direct usage persistence fails", async () => {
    mocks.save.mockRejectedValueOnce(new Error("ledger unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await handleVideoGeneration(request())).status).toBe(500);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(mocks.save).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });
});
