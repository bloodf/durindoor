import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({ store: null }));
vi.mock("fs/promises", () => ({ default: {
  mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    if (fsMock.store === null) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return fsMock.store;
  }),
  access: vi.fn(async () => {}),
} }));
vi.mock("@/lib/cliTools/readExistingConfig", () => ({ writeConfigAtomic: vi.fn(async (_path, text) => { fsMock.store = text; }) }));

// Catalog repos are mocked: no database, settings file or live catalog is touched.
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [{ id: "codex-test", provider: "codex", isActive: true }]),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => []),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("../../open-sse/services/usage/codex.js", () => ({ getCodexModels: vi.fn(async () => null) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));

const { POST } = await import("../../src/app/api/cli-tools/opencode-settings/route.js");
const { buildModelsResponse } = await import("../../src/app/api/v1/models/_shared.js");
const { buildModelsList, LLM_KIND } = await import("../../src/app/api/v1/models/buildModelsList.js");
const { isEffortSuffixedVariantOfListedId } = await import("../../src/shared/utils/effortSuffixedId.js");

const listed = async (models, headers = {}) =>
  (await buildModelsResponse(new Request("http://localhost/v1/models", { headers }), models).json());

const rows = [
  { id: "cc/claude-opus-5-5", thinking_levels: ["low", "high", "max"] },
  { id: "cc/claude-opus-5-5-low", thinking_levels: ["low", "high", "max"] },
  { id: "cc/plain" },
];

describe("OmniRoute #19981 - supported reasoning levels and effort-suffixed aliases", () => {
  beforeEach(() => { fsMock.store = null; });

  it("tells an effort alias from a model whose name ends the same way", () => {
    const ids = new Set(["cx/gpt-6-sol", "mc/muse", "oz/gpt-5.1-codex", "cx/gpt-5.1-codex", "x/nemotron-3"]);
    for (const id of ["cx/gpt-6-sol-ultra", "cx/gpt-6-sol-xhigh", "mc/muse-minimal", "cx/gpt-5.1-codex-max"]) {
      expect(isEffortSuffixedVariantOfListedId(id, ids), id).toBe(true);
    }
    for (const id of ["oz/gpt-5.1-codex-max", "x/nemotron-3-ultra", "cc/unlisted-low", "cx/gpt-6-sol"]) {
      expect(isEffortSuffixedVariantOfListedId(id, ids), id).toBe(false);
    }
  });

  it("mirrors explicit tiers on the OpenAI list, but not on an effort alias", async () => {
    const [base, alias, plain] = (await listed(rows)).data;
    expect(base.supported_reasoning_levels).toEqual(["low", "high", "max"]);
    expect(alias).not.toHaveProperty("supported_reasoning_levels");
    expect(plain).not.toHaveProperty("supported_reasoning_levels");
  });

  it("leaves the Codex envelope, which needs effort objects, unchanged", async () => {
    const { models } = await listed(rows, { originator: "codex_cli_rs" });
    expect(models[0]).not.toHaveProperty("supported_reasoning_levels");
  });

  it("gives a Codex effort alias no effort objects", async () => {
    const models = await buildModelsList([LLM_KIND]);
    const byId = new Map(models.map((model) => [model.id, model]));
    expect(byId.get("cx/gpt-5.4").supported_reasoning_levels?.length).toBeGreaterThan(0);
    expect(byId.get("cx/gpt-5.4-high")).not.toHaveProperty("supported_reasoning_levels");
  });

  it("writes OpenCode variants for the base id and none for its effort alias", async () => {
    await POST({ json: async () => ({ baseUrl: "http://localhost:20128", models: ["cx/gpt-5.4", "cx/gpt-5.4-high"] }) });
    const written = JSON.parse(fsMock.store).provider["9router"].models;
    expect(Object.keys(written["cx/gpt-5.4"].variants).length).toBeGreaterThan(0);
    expect(written["cx/gpt-5.4-high"]).not.toHaveProperty("variants");
  });
});
