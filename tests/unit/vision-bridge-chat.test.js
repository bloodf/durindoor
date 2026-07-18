import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  handleChatCore: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(),
  loadCustomCapabilities: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyByKey: vi.fn(async () => null),
  getApiKeyUsageLimitStatus: vi.fn(async () => ({ exceeded: false, usedTokens: 0, limitTokens: 0 })),
}));

vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
  loadCustomCapabilities: mocks.loadCustomCapabilities,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => "test-key"),
  evaluateApiKeyAuth: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, creds) => creds),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

const NON_VISION = "minimax/MiniMax-M2.1";
const VISION = "openai/gpt-4o";

function imageRequest(model = NON_VISION) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is in this image?" },
            { type: "image_url", image_url: { url: "https://example.com/i.png" } },
          ],
        },
      ],
    }),
  });
}

function baseSettings(overrides = {}) {
  return {
    requireApiKey: false,
    comboStrategy: "fallback",
    comboStickyRoundRobinLimit: 1,
    visionBridgeEnabled: true,
    visionBridgeModel: VISION,
    ...overrides,
  };
}

describe("Vision Bridge (#6640) chat wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(baseSettings());
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockImplementation((modelStr) => {
      if (modelStr === NON_VISION) return Promise.resolve({ provider: "minimax", model: "MiniMax-M2.1" });
      if (modelStr === VISION) return Promise.resolve({ provider: "openai", model: "gpt-4o" });
      return Promise.resolve({ provider: "openai", model: "gpt-4o" });
    });
    mocks.loadCustomCapabilities.mockImplementation(async (_provider, model) => {
      if (model === "MiniMax-M2.1") return { vision: false };
      if (model === "gpt-4o") return { vision: true };
      return null;
    });
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null);
    mocks.getProviderCredentials.mockResolvedValue({ apiKey: "k", providerSpecificData: {} });
    mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("ok", { status: 200 }) });
  });

  it("reroutes image+non-vision request to the configured vision model at dispatch", async () => {
    const res = await handleChat(imageRequest(NON_VISION));

    expect(res.status).toBe(200);
    expect(mocks.handleChatCore).toHaveBeenCalledOnce();
    const call = mocks.handleChatCore.mock.calls[0][0];
    expect(call.body.model).toBe(VISION);
    expect(call.modelInfo).toEqual({ provider: "openai", model: "gpt-4o" });
    // Ordering invariant: original model policy checked before any capability DB
    // lookup, and the bridge-target policy checked before dispatch.
    const policyModels = mocks.enforceApiKeyModelPolicy.mock.calls.map(([, modelStr]) => modelStr);
    expect(policyModels[0]).toBe(NON_VISION);
    expect(policyModels).toContain(VISION);
    const policyOrder = mocks.enforceApiKeyModelPolicy.mock.invocationCallOrder;
    const capsOrder = mocks.loadCustomCapabilities.mock.invocationCallOrder;
    const dispatchOrder = mocks.handleChatCore.mock.invocationCallOrder;
    expect(capsOrder.length).toBeGreaterThan(0);
    expect(dispatchOrder.length).toBe(1);
    expect(policyOrder[0]).toBeLessThan(capsOrder[0]);
    expect(capsOrder[0]).toBeLessThan(dispatchOrder[0]);
    const targetPolicyOrder = policyOrder[policyModels.lastIndexOf(VISION)];
    expect(targetPolicyOrder).toBeLessThan(dispatchOrder[0]);
  });

  it("forwards the original image message content to handleChatCore after reroute", async () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "describe this" },
          { type: "image_url", image_url: { url: "https://example.com/regression.png" } },
        ],
      },
    ];
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: NON_VISION, messages }),
    });

    const res = await handleChat(req);

    expect(res.status).toBe(200);
    const call = mocks.handleChatCore.mock.calls[0][0];
    expect(call.body.model).toBe(VISION);
    // Image-bearing messages must reach the chat core intact.
    expect(call.body.messages).toEqual(messages);
  });

  it("keeps the original model when the bridge is disabled", async () => {
    mocks.getSettings.mockResolvedValue(baseSettings({ visionBridgeEnabled: false }));

    const res = await handleChat(imageRequest(NON_VISION));

    expect(res.status).toBe(200);
    expect(mocks.handleChatCore.mock.calls[0][0].body.model).toBe(NON_VISION);
  });

  it("keeps the original model when the rerouted target is denied by API key policy", async () => {
    // Bridge-target policy check returns an error Response → bridge must NOT apply.
    mocks.enforceApiKeyModelPolicy.mockImplementation(async (_req, modelStr) =>
      modelStr === VISION ? new Response("denied", { status: 403 }) : null,
    );

    const res = await handleChat(imageRequest(NON_VISION));

    expect(res.status).toBe(200);
    expect(mocks.handleChatCore.mock.calls[0][0].body.model).toBe(NON_VISION);
    // Original model's own policy gate in handleSingleModelChat still ran.
    expect(mocks.enforceApiKeyModelPolicy).toHaveBeenCalledWith(expect.anything(), NON_VISION);
  });

  it("does not reroute when the request has no current-turn image", async () => {
    const textOnly = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: NON_VISION, messages: [{ role: "user", content: "hi" }] }),
    });

    const res = await handleChat(textOnly);

    expect(res.status).toBe(200);
    expect(mocks.handleChatCore.mock.calls[0][0].body.model).toBe(NON_VISION);
    // No bridge policy check against the vision target.
    expect(mocks.enforceApiKeyModelPolicy).not.toHaveBeenCalledWith(expect.anything(), VISION);
  });
});
