import { expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ openrouterRouting: { zdr: true } }) }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: async () => ({ provider: "openrouter", model: "embedding-model" }) }));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: async () => null }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: vi.fn(),
  markAccountUnavailable: vi.fn(),
}));
vi.mock("@/sse/handlers/modelKind.js", () => ({ modelKindError: async () => null }));
vi.mock("@/sse/handlers/imageModelKind.js", () => ({ imageModelKindError: async () => null }));

const { resolveImageModel, resolveTypedMediaModel } = await import("@/sse/handlers/media/pipeline.js");

it("applies image ZDR routing only to image model resolution", async () => {
  const body = { model: "openrouter/embedding-model", input: "hello" };
  const original = structuredClone(body);
  const typed = await resolveTypedMediaModel(new Request("http://localhost"), body.model, body, null, "embedding");
  expect(typed.error).toBeNull();
  expect(body).toEqual(original);

  const image = await resolveImageModel(new Request("http://localhost"), body.model, body, null);
  expect(image.error.status).toBe(400);
  expect((await image.error.json()).error.message).toMatch(/ZDR requirement/);
});
