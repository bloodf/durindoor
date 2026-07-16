import { beforeEach, describe, expect, it, vi } from "vitest";
import { markAccountUnavailable } from "../../src/sse/services/auth.js";
import { isPassthroughConnectionWideError } from "../../open-sse/services/accountFallback.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  recordProviderConnectionFallbackState: vi.fn(),
}));

// Partial mock: keep the real localDb module, override only the three exports
// this test observes. Avoids drift when auth.js imports new localDb symbols.
vi.mock("@/lib/localDb", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProviderConnections: mocks.getProviderConnections,
    updateProviderConnection: mocks.updateProviderConnection,
    recordProviderConnectionFallbackState: mocks.recordProviderConnectionFallbackState,
  };
});

// #6888: NVIDIA NIM multiplexes many unrelated vendor models (z-ai/, qwen/,
// deepseek-ai/, …) behind ONE base URL + ONE API key. A single stale/renamed
// model's 404 must cool only that model; a connection-class failure (5xx)
// must cool the whole connection. Mirrors OmniRoute #6773/#6888.
describe("NVIDIA NIM passthrough per-model 404 scoping (#6888)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { id: "nv-1", provider: "nvidia", apiKey: "nvapi-key", backoffLevel: 0 },
    ]);
    mocks.recordProviderConnectionFallbackState.mockResolvedValue({ applied: true });
  });

  it("nvidia registry entry sets passthroughModels", () => {
    expect(AI_PROVIDERS.nvidia?.passthroughModels).toBe(true);
  });

  it("isPassthroughConnectionWideError: 404 model-scoped, 5xx/0 connection-wide, non-passthrough untouched", () => {
    // Per-model signal: 404 (stale/renamed catalog id) retains bounded scope
    expect(isPassthroughConnectionWideError(true, 404)).toBe(false);
    // Connection-class failures → account-wide lock
    expect(isPassthroughConnectionWideError(true, 500)).toBe(true);
    expect(isPassthroughConnectionWideError(true, 503)).toBe(true);
    expect(isPassthroughConnectionWideError(true, 0)).toBe(true);
    // Non-passthrough providers never take this branch
    expect(isPassthroughConnectionWideError(false, 503)).toBe(false);
    expect(isPassthroughConnectionWideError(undefined, 503)).toBe(false);
  });

  it("404 on a listed NIM model locks only that model (atomic path receives the model)", async () => {
    const result = await markAccountUnavailable(
      "nv-1",
      404,
      "Not Found",
      "nvidia",
      "z-ai/glm-5.2",
    );

    expect(result.shouldFallback).toBe(true);
    // Atomic path receives the canonical model → bounded to modelLock_z-ai/glm-5.2
    expect(mocks.recordProviderConnectionFallbackState).toHaveBeenCalledWith(
      "nv-1",
      expect.objectContaining({ model: "z-ai/glm-5.2", status: 404 }),
      expect.anything(),
    );
    // Compatibility fallback must not run
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("503 on the same listed NIM model locks the whole connection (atomic path receives null)", async () => {
    const result = await markAccountUnavailable(
      "nv-1",
      503,
      "Service Unavailable",
      "nvidia",
      "z-ai/glm-5.2",
    );

    expect(result.shouldFallback).toBe(true);
    // model: null → boundedModelScope collapses to __all → modelLock___all
    expect(mocks.recordProviderConnectionFallbackState).toHaveBeenCalledWith(
      "nv-1",
      expect.objectContaining({ model: null, status: 503 }),
      expect.anything(),
    );
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("compatibility path: 404 writes the model lock key, 503 writes the account-wide key", async () => {
    // Force the legacy fallback branch
    mocks.recordProviderConnectionFallbackState.mockRejectedValue(new Error("no atomic"));

    await markAccountUnavailable("nv-1", 404, "Not Found", "nvidia", "z-ai/glm-5.2");
    const lock404 = Object.keys(mocks.updateProviderConnection.mock.calls.at(-1)[1])
      .find((k) => k.startsWith("modelLock_"));
    expect(lock404).toBe("modelLock_z-ai/glm-5.2");

    await markAccountUnavailable("nv-1", 503, "Service Unavailable", "nvidia", "z-ai/glm-5.2");
    const lock503 = Object.keys(mocks.updateProviderConnection.mock.calls.at(-1)[1])
      .find((k) => k.startsWith("modelLock_"));
    expect(lock503).toBe("modelLock___all");
  });

});
