// #1500: a client abort must not cool down the account, fall through accounts, or keep a combo going.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  core: vi.fn(),
  credentials: vi.fn(),
  markUnavailable: vi.fn(),
  comboModels: vi.fn(),
  noAuth: vi.fn(),
  wantsDefault: vi.fn(),
  route: vi.fn()
}));

vi.mock("../../open-sse/handlers/imageGenerationCore.js", () => ({ handleImageGenerationCore: m.core }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: m.credentials,
  getNoAuthProviderCredentials: m.noAuth,
  markAccountUnavailable: m.markUnavailable,
  clearAccountError: vi.fn(),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null, billingEpoch: null } }))
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  getApiKeyByKey: vi.fn(async () => null),
  getComboForModel: vi.fn(async () => null)
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async (model) => {
    const [provider, ...rest] = String(model).split("/");
    return { provider, model: rest.join("/") };
  }),
  getComboModels: m.comboModels,
  getComboCanonicalName: vi.fn(async () => null)
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(async (_p, creds) => creds)
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
  recordApiKeyUsageForResponse: vi.fn(async (_k, response) => response)
}));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({
  captureRequestBillingEpoch: vi.fn(async () => {}),
  getRequestId: vi.fn(() => "req-1"),
  withRequestCorrelation: (fn) => fn
}));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: (...a) => m.wantsDefault(...a),
  resolveMediaRoute: (...a) => m.route(...a),
  defaultRouteComboOptions: () => ({})
}));
vi.mock("../../open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));

const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");

const abortedResult = () => ({
  success: false,
  status: 499,
  error: "Image generation request aborted",
  response: new Response(JSON.stringify({ error: { message: "aborted" } }), { status: 499 })
});

function request(controller, model = "runwayml/gen4_image") {
  return new Request("http://localhost/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: "a fox" }),
    signal: controller.signal
  });
}

describe("image generation handler: client abort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.comboModels.mockResolvedValue(null);
    m.wantsDefault.mockReturnValue(false);
    // Bounded: a second account lookup means the handler fell through to another account.
    m.credentials
      .mockResolvedValueOnce({ connectionId: "conn-1", apiKey: "k" })
      .mockResolvedValue({ allRateLimited: true, lastError: "exhausted", retryAfter: null });
    m.markUnavailable.mockResolvedValue({ shouldFallback: true });
  });

  it("passes request.signal to the core and returns 499 without marking the account or trying others", async () => {
    const ctrl = new AbortController();
    m.core.mockImplementation(async () => { ctrl.abort(); return abortedResult(); });
    const req = request(ctrl);
    const response = await handleImageGeneration(req);
    expect(response.status).toBe(499);
    expect(m.core.mock.calls[0][0].signal).toBe(req.signal);
    expect(m.markUnavailable).not.toHaveBeenCalled();
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(m.core).toHaveBeenCalledTimes(1);
  });

  it("still marks the account unavailable for a genuine provider failure", async () => {
    const ctrl = new AbortController();
    m.core.mockResolvedValue({ success: false, status: 502, error: "boom", response: new Response("{}", { status: 502 }) });
    m.markUnavailable.mockResolvedValue({ shouldFallback: false });
    await handleImageGeneration(request(ctrl));
    expect(m.markUnavailable).toHaveBeenCalledTimes(1);
  });

  it("a combo stops on client abort and does not try the next member", async () => {
    const ctrl = new AbortController();
    m.comboModels.mockResolvedValue(["runwayml/gen4_image", "fal-ai/flux"]);
    m.credentials.mockReset().mockResolvedValue({ connectionId: "conn-1", apiKey: "k" });
    m.core
      .mockImplementationOnce(async () => { ctrl.abort(); return abortedResult(); })
      .mockResolvedValue({ success: true, response: new Response("ok"), accounting: {} });
    const req = request(ctrl, "my-combo");
    const response = await handleImageGeneration(req);
    expect(response.status).toBe(499);
    expect(m.core).toHaveBeenCalledTimes(1);
    expect(m.core.mock.calls[0][0].signal).toBe(req.signal);
    expect(m.markUnavailable).not.toHaveBeenCalled();
  });

  // The core reports 502 here, so only the combo's own signal check can stop it.
  const abortThenSucceed = (ctrl) => m.core
    .mockImplementationOnce(async () => {
      ctrl.abort();
      return { success: false, status: 502, error: "x", response: new Response("{}", { status: 502 }) };
    })
    .mockResolvedValue({ success: true, response: new Response("ok"), accounting: {} });

  it("named combo stops on client abort even when the core reports a plain failure", async () => {
    const ctrl = new AbortController();
    m.credentials.mockReset().mockResolvedValue({ connectionId: "conn-1", apiKey: "k" });
    m.comboModels.mockResolvedValue(["runwayml/gen4_image", "fal-ai/flux"]);
    abortThenSucceed(ctrl);
    const response = await handleImageGeneration(request(ctrl, "my-combo"));
    expect(response.status).toBe(499);
    expect(m.core).toHaveBeenCalledTimes(1);
  });

  it("default-route combo stops on client abort even when the core reports a plain failure", async () => {
    const ctrl = new AbortController();
    m.credentials.mockReset().mockResolvedValue({ connectionId: "conn-1", apiKey: "k" });
    m.wantsDefault.mockReturnValue(true);
    m.route.mockResolvedValue({ models: ["runwayml/gen4_image", "fal-ai/flux"] });
    abortThenSucceed(ctrl);
    const response = await handleImageGeneration(request(ctrl, "default"));
    expect(response.status).toBe(499);
    expect(m.core).toHaveBeenCalledTimes(1);
  });

  it("no-auth providers also receive request.signal", async () => {
    const ctrl = new AbortController();
    m.noAuth.mockResolvedValue({ connectionId: "n1" });
    m.core.mockResolvedValue({ success: true, response: new Response("ok"), accounting: {} });
    const req = request(ctrl, "sdwebui/sdxl");
    await handleImageGeneration(req);
    expect(m.core.mock.calls[0][0].signal).toBe(req.signal);
  });
});
