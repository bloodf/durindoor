import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
}));

const originalFetch = global.fetch;

// A MiniMax prompt rejected by the provider content filter (status_code 1026)
// is a per-request rejection, NOT an account/auth/quota failure. The full path —
// core 422 marker -> markAccountUnavailable — must never lock the connection or
// enter the account-fallback cooldown chain over a single filtered prompt.
describe("MiniMax content-filter no-lock guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { image_urls: [] },
          base_resp: { status_code: 1026, status_msg: "Sensitive content detected in prompt" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    mocks.getProviderConnections.mockResolvedValue([
      { id: "minimax-1", provider: "minimax", email: "mm@example.com", backoffLevel: 0 },
    ]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns 422 and does NOT lock the connection on a content-filtered prompt", async () => {
    const core = await handleImageGenerationCore({
      body: { prompt: "A mountain" },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });
    expect(core.success).toBe(false);
    expect(core.status).toBe(422);

    // Feed the core's error through the real fallback classifier exactly as
    // src/sse/handlers/imageGeneration.js does.
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable("minimax-1", core.status, core.error, "minimax", "image-01");

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("returns 422 and does NOT lock when a generation is content-blocked (failed_count>0, no 1026)", async () => {
    global.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { image_urls: [] },
          metadata: { failed_count: 1, success_count: 0 },
          base_resp: { status_code: 0, status_msg: "generation blocked" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const core = await handleImageGenerationCore({
      body: { prompt: "A mountain" },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });
    expect(core.success).toBe(false);
    expect(core.status).toBe(422);
    expect(core.error).toContain("provider_request_rejected");

    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable("minimax-1", core.status, core.error, "minimax", "image-01");
    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("still falls back for a genuine 502 upstream failure (no filter signal)", async () => {
    global.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { image_urls: [] }, base_resp: { status_code: 0, status_msg: "" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const core = await handleImageGenerationCore({
      body: { prompt: "A mountain" },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });
    expect(core.status).toBe(502);

    const { checkFallbackError } = await import("../../open-sse/services/accountFallback.js");
    const decision = checkFallbackError(core.status, core.error, 0);
    expect(decision.shouldFallback).toBe(true);
  });
});
