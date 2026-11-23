import { afterEach, describe, expect, it, vi } from "vitest";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import nvidia from "../../open-sse/providers/registry/nvidia.js";

describe("NVIDIA image generation", () => {
  it("routes catalogued FLUX requests and normalizes artifacts", () => {
    const adapter = getImageAdapter("nvidia");
    const model = "black-forest-labs/flux.1-dev";
    expect(nvidia.serviceKinds).toContain("image");
    expect(nvidia.models.find((entry) => entry.id === model)?.kind).toBe("image");
    expect(adapter.buildUrl(model, { providerSpecificData: { baseUrl: "https://evil.example" } })).toBe(`https://ai.api.nvidia.com/v1/genai/${model}`);
    expect(() => adapter.buildUrl("../../other")).toThrow();
    expect(adapter.buildBody(model, { prompt: "cat", size: "768x1344", cfg_scale: 1.1 })).toEqual({ prompt: "cat", width: 768, height: 1344, mode: "base", cfg_scale: 1.1 });
    expect(adapter.normalize({ artifacts: [{ base64: "abc" }] }).data).toEqual([{ b64_json: "abc" }]);
    expect(() => adapter.buildBody("black-forest-labs/flux.1-kontext-dev", { prompt: "edit" })).toThrow();
  });
});

vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn().mockResolvedValue("test-token") }));

describe("NVIDIA dashboard probes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses image generation for text and edit models, preserving internal authentication", async () => {
    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: "image" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    for (const id of ["flux.1-schnell", "flux.1-kontext-dev"]) {
      const model = `nvidia/black-forest-labs/${id}`;
      expect((await pingModelByKind(model, "image", "http://127.0.0.1:20127", "connection")).ok).toBe(true);
      const [url, options] = fetchMock.mock.calls.at(-1);
      expect(url).toBe("http://127.0.0.1:20127/api/v1/images/generations");
      expect(options.headers["x-9r-cli-token"]).toBe("test-token");
      expect(options.headers["x-connection-id"]).toBe("connection");
      const body = JSON.parse(options.body);
      expect(body.model).toBe(model);
      expect(body.image).toBe(id === "flux.1-kontext-dev" ? "data:image/png;example_id,0" : undefined);
    }
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{}] }) });
    expect((await pingModelByKind("nvidia/black-forest-labs/flux.1-schnell", "image", "http://127.0.0.1:20127")).ok).toBe(false);
  });
});

it("infers image kind from the dashboard catalog", async () => {
  const { POST } = await import("../../src/app/api/models/test/route.js");
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ url: "https://example.test/image.png" }] }) });
  vi.stubGlobal("fetch", fetchMock);
  const response = await POST(new Request("http://localhost/api/models/test", { method: "POST", body: JSON.stringify({ model: "nvidia/black-forest-labs/flux.1-schnell" }) }));
  expect((await response.json()).ok).toBe(true);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/images\/generations$/);
  vi.unstubAllGlobals();
});
