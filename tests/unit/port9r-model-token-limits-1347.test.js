import { describe, it, expect, vi } from "vitest";
import { normalizeCustomCapabilities } from "../../src/lib/db/repos/aliasRepo.js";
import { resolveCustomCapabilities } from "../../src/sse/services/model.js";
import { projectDiscoveryMetadata } from "../../open-sse/services/modelMetadata.js";

const mocks = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn() }));
vi.mock("@/models", () => ({ getCustomModels: vi.fn(), addCustomModel: mocks.add, updateCustomModel: mocks.update, deleteCustomModel: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));

describe("custom model token limits", () => {
  it("maps upstream fields into persisted capabilities on create and update", async () => {
    const { POST, PATCH } = await import("../../src/app/api/models/custom/route.js");
    mocks.add.mockImplementation(async (model) => model);
    mocks.update.mockImplementation(async (model) => model);
    for (const [handler, method] of [[POST, "POST"], [PATCH, "PATCH"]]) {
      const response = await handler(new Request("http://localhost", { method, body: JSON.stringify({ providerAlias: "openai", id: "custom", max_input_tokens: 4096, max_output_tokens: "512", capabilities: { tools: true } }) }));
      expect((await response.json()).model.capabilities).toEqual({ contextWindow: 4096, maxInput: 4096, maxOutput: 512, tools: true });
    }
  });

  it("validates limits and applies the provider and kind scoped override", () => {
    expect(normalizeCustomCapabilities({ contextWindow: -1 }).ok).toBe(false);
    expect(normalizeCustomCapabilities({ maxOutput: 1.5 }).ok).toBe(false);
    const rows = [
      { providerAlias: "openai", id: "model", type: "embedding", capabilities: { contextWindow: 10 } },
      { providerAlias: "openai", id: "model", type: "llm", capabilities: { contextWindow: 4096, maxInput: 4096, maxOutput: 512 } },
    ];
    const resolved = resolveCustomCapabilities("openai", "model", "openai", rows, { contextWindow: 1000, maxOutput: 100 }, "llm");
    expect(resolved).toMatchObject({ contextWindow: 4096, maxInput: 4096, maxOutput: 512 });
    expect(resolveCustomCapabilities("anthropic", "model", "anthropic", rows, {}, "llm")).toBeNull();
  });

  it("publishes resolved input and output limits", () => {
    const result = projectDiscoveryMetadata({ id: "x", capabilities: { contextWindow: 4096, maxInput: 3000, maxOutput: 512 } });
    expect(result).toMatchObject({ context_length: 4096, max_input_tokens: 3000, max_output_tokens: 512 });
  });
});
