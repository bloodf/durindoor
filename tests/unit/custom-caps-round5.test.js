import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCustomModels: vi.fn(), getComboModels: vi.fn() }));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: vi.fn(),
  getComboByName: vi.fn(),
  getProviderNodes: vi.fn(async () => []),
  getProviderConnections: vi.fn(),
  getCustomModels: mocks.getCustomModels,
}));

describe("thinkingRange zero minimum", () => {
  it("accepts min 0 in normalizeCustomCapabilities", async () => {
    const { normalizeCustomCapabilities } = await import("../../src/lib/db/repos/aliasRepo.js");
    const out = normalizeCustomCapabilities({ thinkingRange: { min: 0, max: 1024 } });
    expect(out.ok).toBe(true);
    expect(out.caps.thinkingRange).toEqual({ min: 0, max: 1024 });
  });

  it("still rejects negative min", async () => {
    const { normalizeCustomCapabilities } = await import("../../src/lib/db/repos/aliasRepo.js");
    const out = normalizeCustomCapabilities({ thinkingRange: { min: -1, max: 1024 } });
    expect(out.ok).toBe(false);
  });
});

describe("azure executor custom maxOutput clamp", () => {
  it("clamps the azure body like DefaultExecutor", async () => {
    const { AzureExecutor } = await import("../../open-sse/executors/azure.js");
    const ex = new AzureExecutor();
    const ctx = { modelCapabilities: { maxOutput: 2048 } };
    const out = ex.clampCustomMaxOutput(ex.transformRequest("custom-x", { max_tokens: 9000 }, false, {}, ctx), ctx);
    expect(out.max_tokens).toBe(2048);
  });
});
