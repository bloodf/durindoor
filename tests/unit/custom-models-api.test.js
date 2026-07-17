import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomModels: vi.fn(),
  addCustomModel: vi.fn(),
  updateCustomModel: vi.fn(),
  deleteCustomModel: vi.fn(),
}));

vi.mock("@/models", () => ({
  getCustomModels: mocks.getCustomModels,
  addCustomModel: mocks.addCustomModel,
  updateCustomModel: mocks.updateCustomModel,
  deleteCustomModel: mocks.deleteCustomModel,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

async function readJson(response) {
  return response.json();
}

describe("/api/models/custom persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET lists custom models", async () => {
    mocks.getCustomModels.mockResolvedValue([
      { providerAlias: "ollama", id: "custom-llama", type: "llm", name: "Custom Llama", capabilities: { vision: true } },
    ]);

    const { GET } = await import("../../src/app/api/models/custom/route.js");
    const res = await GET();
    const data = await readJson(res);

    expect(data.models).toHaveLength(1);
    expect(data.models[0].capabilities).toEqual({ vision: true });
  });

  it("POST adds a custom model and returns capabilities", async () => {
    const caps = { vision: true, contextWindow: 32768 };
    mocks.addCustomModel.mockResolvedValue({ providerAlias: "ollama", id: "custom-llama", type: "llm", name: "Custom Llama", capabilities: caps });

    const { POST } = await import("../../src/app/api/models/custom/route.js");
    const res = await POST(
      new Request("http://localhost/api/models/custom", {
        method: "POST",
        body: JSON.stringify({ providerAlias: "ollama", id: "custom-llama", type: "llm", name: "Custom Llama", capabilities: caps }),
      })
    );
    const data = await readJson(res);

    expect(data.success).toBe(true);
    expect(data.added.capabilities).toEqual(caps);
    expect(mocks.addCustomModel).toHaveBeenCalledWith(
      expect.objectContaining({ capabilities: caps })
    );
  });

  it("PATCH edits custom model capabilities", async () => {
    const caps = { vision: true, thinking: true, thinkingFormat: "openai" };
    mocks.updateCustomModel.mockResolvedValue({ providerAlias: "ollama", id: "custom-llama", type: "llm", name: "Custom Llama", capabilities: caps });

    const { PATCH } = await import("../../src/app/api/models/custom/route.js");
    const res = await PATCH(
      new Request("http://localhost/api/models/custom", {
        method: "PATCH",
        body: JSON.stringify({ providerAlias: "ollama", id: "custom-llama", type: "llm", name: "Custom Llama", capabilities: caps }),
      })
    );
    const data = await readJson(res);

    expect(data.success).toBe(true);
    expect(data.updated.capabilities).toEqual(caps);
  });

  it("DELETE removes a custom model", async () => {
    mocks.deleteCustomModel.mockResolvedValue();

    const { DELETE } = await import("../../src/app/api/models/custom/route.js");
    const res = await DELETE(
      new Request("http://localhost/api/models/custom?providerAlias=ollama&id=custom-llama&type=llm", { method: "DELETE" })
    );
    const data = await readJson(res);

    expect(data.success).toBe(true);
    expect(mocks.deleteCustomModel).toHaveBeenCalledWith({ providerAlias: "ollama", id: "custom-llama", type: "llm" });
  });
});
