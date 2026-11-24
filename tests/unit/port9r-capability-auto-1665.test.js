import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/models/buildModelsList.js", () => ({ buildModelsList: vi.fn(async ([kind]) => kind === "llm" ? [
  { id: "openai/gpt-5-pro", owned_by: "openai", kind: "llm" },
  { id: "openai/gpt-5-mini", owned_by: "openai", kind: "llm" },
  { id: "saved", owned_by: "combo", kind: "llm" }
] : kind === "image" ? [{ id: "openai/flash-image", owned_by: "openai", kind: "image" }, { id: "openai/denied-image", owned_by: "openai", kind: "image" }] : []) }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: vi.fn(async () => [
  { provider: "openai", isActive: true, testStatus: "unavailable", priority: 1 },
  { provider: "openai", isActive: true, testStatus: "active", priority: 2 }
]) }));
vi.mock("@/sse/services/modelAccess.js", () => ({ getRequestModelDiscoveryOptions: vi.fn(async () => ({})), filterModelsForRequest: vi.fn(async (_request, rows) => rows.filter((m) => !m.id.includes("denied"))) }));
vi.mock("@/sse/services/mediaRoutes.js", () => ({
  listMediaRouteCandidates: vi.fn(async () => [{ id: "openai/flash-image", owned_by: "openai" }, { id: "openai/denied-image", owned_by: "openai" }]),
  mediaEndpointSupport: vi.fn(() => ({ supported: true })), providerOfModelId: (id) => id.split("/")[0]
}));

import { annotateAvailability, getAutoModelCandidates, getCapabilityCatalog, parseAutoModel, rankAutoModels } from "@/sse/services/autoModel.js";

describe("capability catalog and auto selectors", () => {
  it("keeps family combos separate and rejects invalid selectors", () => {
    expect(parseAutoModel("auto/gpt")).toBeNull();
    expect(parseAutoModel("fast:unknown")).toBeNull();
    expect(parseAutoModel("best:video")).toEqual({ strategy: "best", kind: "video", name: "best:video" });
  });
  it("uses healthy active connections and excludes unavailable models from ranking", () => {
    const rows = annotateAvailability([{ id: "openai/a", kind: "llm" }], [
      { provider: "openai", testStatus: "unavailable" }, { provider: "openai", testStatus: "active", priority: 2 }
    ]);
    expect(rows[0].availability.status).toBe("available");
    expect(rankAutoModels([...rows, { id: "x/b", availability: { status: "unavailable" } }], "auto").map((m) => m.id)).toEqual(["openai/a"]);
  });
  it("ranks candidates in fallback order and exposes concrete catalog rows", async () => {
    const request = new Request("http://localhost/v1/models/capabilities");
    const catalog = await getCapabilityCatalog(request, ["llm"]);
    expect(catalog.map((m) => m.id)).toEqual(["openai/gpt-5-pro", "openai/gpt-5-mini", "saved"]);
    expect(catalog[0]).toMatchObject({ endpoint: "/v1/chat/completions", availability: { status: "available" }, priority: 2 });
    expect((await getAutoModelCandidates("cheap", "llm", request)).models).toEqual(["openai/gpt-5-mini", "openai/gpt-5-pro"]);
    expect((await getAutoModelCandidates("best", "llm", request)).models).toEqual(["openai/gpt-5-pro", "openai/gpt-5-mini"]);
  });
  it("selects accessible models for the requested media kind", async () => {
    const request = new Request("http://localhost/v1/images/generations");
    expect((await getAutoModelCandidates("fast:image", "image", request)).models).toEqual(["openai/flash-image"]);
    expect(await getAutoModelCandidates("fast:video", "image", request)).toBeNull();
  });
});

it("advertises selectors only for supported kinds with concrete models", async () => {
  const { addAutoModelSelectors } = await import("@/shared/utils/autoModelSelectors.js");
  const models = [{ id: "openai/image", owned_by: "openai" }];
  expect(addAutoModelSelectors(models, "image").map((m) => m.id)).toEqual(["auto:image", "best:image", "fast:image", "cheap:image", "openai/image"]);
  expect(addAutoModelSelectors(models, "tts")).toEqual(models);
  expect(addAutoModelSelectors([], "llm")).toEqual([]);
});

it("falls back in ranked order when the first selected model is unavailable", async () => {
  const { handleComboChat } = await import("../../open-sse/services/combo.js");
  const request = new Request("http://localhost/v1/chat/completions");
  const selected = await getAutoModelCandidates("cheap", "llm", request);
  const attempts = [];
  const response = await handleComboChat({
    body: { messages: [{ role: "user", content: "hello" }] }, models: selected.models,
    comboName: "port-1665-fallback", comboStrategy: "fallback", autoSwitch: false,
    log: { info() {}, warn() {}, debug() {}, error() {} },
    handleSingleModel: async (_body, model) => {
      attempts.push(model);
      return attempts.length === 1 ? Response.json({ error: { message: "rate limit" } }, { status: 429 }) : Response.json({ choices: [{ message: { content: "ok" } }] });
    }
  });
  expect(response.status).toBe(200);
  expect(attempts).toEqual(["openai/gpt-5-mini", "openai/gpt-5-pro"]);
});
