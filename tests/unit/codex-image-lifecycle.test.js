import { describe, expect, it, vi } from "vitest";

// Retired Codex image ids must answer 410 with the replacement before any
// account is selected (upstream decolua/9router@7878f53b retired gpt-5.5).
const mocks = vi.hoisted(() => ({
  core: vi.fn(),
  credentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  getApiKeyByKey: vi.fn().mockResolvedValue(null),
  getComboForModel: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  resolveClientApiKey: vi.fn().mockResolvedValue({ apiKey: null, auth: { ok: true, apiKeyId: null } }),
  getProviderCredentialsWithQuotaPreflight: mocks.credentials,
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async (modelStr) => ({ provider: "codex", model: modelStr.split("/").pop() })),
  getComboModels: vi.fn().mockResolvedValue(null),
  getComboCanonicalName: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn().mockResolvedValue(null),
  recordApiKeyUsageForResponse: vi.fn((_key, response) => response),
}));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: () => false,
  resolveMediaRoute: vi.fn(),
  defaultRouteComboOptions: vi.fn(),
}));
vi.mock("open-sse/handlers/imageGenerationCore.js", () => ({ handleImageGenerationCore: mocks.core }));

const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");

describe("Codex image lifecycle gate", () => {
  it("rejects cx/gpt-5.5-image with 410 and the gpt-6-sol-image replacement", async () => {
    const response = await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "cx/gpt-5.5-image", prompt: "a square" }),
    }));

    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.error.code).toBe("model_shutdown");
    expect(body.error.message).toMatch(/codex\/gpt-6-sol-image/);
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.core).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});
