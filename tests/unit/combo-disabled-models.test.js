import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

const mocks = vi.hoisted(() => ({
  getComboForModel: vi.fn(),
  getModelAliases: vi.fn(),
  getProviderNodes: vi.fn(),
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getComboForModel: mocks.getComboForModel,
  getModelAliases: mocks.getModelAliases,
  getProviderNodes: mocks.getProviderNodes,
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));

async function getComboModels() {
  return (await import("../../src/sse/services/model.js")).getComboModels;
}

const log = { info: () => {}, warn: () => {}, debug: () => {} };
function okResponse(content) {
  const make = () => ({ ok: true, status: 200, clone: make, json: async () => ({ choices: [{ message: { role: "assistant", content } }] }) });
  return make();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getComboForModel.mockResolvedValue(null);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getProviderNodes.mockResolvedValue([]);
  mocks.getProviderConnections.mockResolvedValue([]);
  mocks.getSettings.mockResolvedValue({ disabledFreeProviders: [] });
  mocks.getDisabledModels.mockResolvedValue({});
});

describe("disabled saved combo members", () => {
  it("matches the registry alias of the canonical owner", async () => {
    const combo = { name: "registry", models: ["alibaba/qwen3", "openai/gpt-4o"] };
    mocks.getComboForModel.mockResolvedValue(combo);
    mocks.getDisabledModels.mockResolvedValue({ ali: ["qwen3"] });

    const result = await (await getComboModels())("registry");

    expect(result).toEqual(["openai/gpt-4o"]);
    expect(combo.models).toEqual(["alibaba/qwen3", "openai/gpt-4o"]);
    expect(mocks.getDisabledModels).toHaveBeenCalledTimes(1);
  });

  it("matches the saved member's literal provider form and canonical registry owner id", async () => {
    // Canonical id form saved: matches both the literal id and the registry alias.
    mocks.getComboForModel.mockResolvedValue({ name: "id-form", models: ["mimo-free/mimo-auto", "openai/gpt-4o-mini"] });
    mocks.getDisabledModels.mockResolvedValue({ mmf: ["mimo-auto"] });
    await expect((await getComboModels())("id-form")).resolves.toEqual(["openai/gpt-4o-mini"]);

    // Non-colliding registry alias form: ali resolves to owner id alibaba, so a row
    // stored under that canonical id must remove ali/qwen3 too.
    mocks.getDisabledModels.mockResolvedValue({ alibaba: ["qwen3"] });
    mocks.getComboForModel.mockResolvedValue({ name: "alias-owner-id", models: ["ali/qwen3", "openai/gpt-4o-mini"] });
    await expect((await getComboModels())("alias-owner-id")).resolves.toEqual(["openai/gpt-4o-mini"]);

    // Exact-id-first protects the independent `id: mmf` entry from the earlier
    // mimo-free alias: mmf. A mimo-free disable must not affect saved mmf/*.
    mocks.getDisabledModels.mockResolvedValue({ "mimo-free": ["mimo-auto"] });
    mocks.getComboForModel.mockResolvedValue({ name: "alias-form", models: ["mmf/mimo-auto", "openai/gpt-4o-mini"] });
    await expect((await getComboModels())("alias-form")).resolves.toEqual(["mmf/mimo-auto", "openai/gpt-4o-mini"]);
  });

  it("matches compatible storage ID, configured output prefix, and the inverse prefix form", async () => {
    mocks.getProviderNodes.mockResolvedValue([{ id: "node-1", prefix: "team-openai", type: "openai-compatible" }]);

    mocks.getDisabledModels.mockResolvedValue({ "team-openai": ["gpt-4o"] });
    mocks.getComboForModel.mockResolvedValue({ name: "by-prefix", models: ["team-openai/gpt-4o", "openai/gpt-4o-mini"] });
    await expect((await getComboModels())("by-prefix")).resolves.toEqual(["openai/gpt-4o-mini"]);

    mocks.getComboForModel.mockResolvedValue({ name: "by-storage", models: ["node-1/gpt-4o", "openai/gpt-4o-mini"] });
    await expect((await getComboModels())("by-storage")).resolves.toEqual(["openai/gpt-4o-mini"]);

    mocks.getDisabledModels.mockResolvedValue({ "node-1": ["gpt-4o"] });
    mocks.getComboForModel.mockResolvedValue({ name: "storage-key", models: ["team-openai/gpt-4o", "openai/gpt-4o-mini"] });
    await expect((await getComboModels())("storage-key")).resolves.toEqual(["openai/gpt-4o-mini"]);
  });

  it("does not let a compatible node shadow a reserved registry provider", async () => {
    // A configured node whose prefix collides with a reserved registry provider
    // (here: prefix 'openai' matches the built-in `openai` provider) must NOT
    // take over disabled filtering for the reserved provider's saved member.
    mocks.getProviderNodes.mockResolvedValue([{ id: "node-shadow", prefix: "openai", type: "openai-compatible" }]);
    mocks.getDisabledModels.mockResolvedValue({ "node-shadow": ["gpt-4o"] });
    mocks.getComboForModel.mockResolvedValue({ name: "reserved", models: ["openai/gpt-4o", "openai/gpt-4o-mini"] });
    await expect((await getComboModels())("reserved")).resolves.toEqual(["openai/gpt-4o", "openai/gpt-4o-mini"]);

    // Direct raw node id is not reserved, so a disabled row keyed by that storage
    // id still filters a saved member stored under the same node id.
    mocks.getProviderNodes.mockResolvedValue([{ id: "node-2", prefix: "team-openai", type: "openai-compatible" }]);
    mocks.getDisabledModels.mockResolvedValue({ "node-2": ["gpt-4o"] });
    mocks.getComboForModel.mockResolvedValue({ name: "by-storage-2", models: ["node-2/gpt-4o", "openai/gpt-4o-mini"] });
    await expect((await getComboModels())("by-storage-2")).resolves.toEqual(["openai/gpt-4o-mini"]);

    // Non-reserved prefix form still drops on its own disabled row.
    mocks.getDisabledModels.mockResolvedValue({ "team-openai": ["gpt-4o"] });
    mocks.getComboForModel.mockResolvedValue({ name: "by-prefix-2", models: ["team-openai/gpt-4o", "openai/gpt-4o-mini"] });
    await expect((await getComboModels())("by-prefix-2")).resolves.toEqual(["openai/gpt-4o-mini"]);
  });

  it("keeps the original member array identity when no saved member is disabled (passthrough contract)", async () => {
    const members = ["openai/gpt-4o", "aug/claude-sonnet-4.6"];
    mocks.getComboForModel.mockResolvedValue({ name: "clean", models: members });
    // Unrelated provider has disabled rows; must not clone the combo array.
    mocks.getDisabledModels.mockResolvedValue({ alibaba: ["qwen3"], anthropic: ["claude-opus-4-6"] });

    const result = await (await getComboModels())("clean");

    expect(result).toBe(members);
  });

  it("fails open and returns the original member array when the disabled-models store rejects", async () => {
    const members = ["alibaba/qwen3", "openai/gpt-4o"];
    mocks.getComboForModel.mockResolvedValue({ name: "store-down", models: members });
    mocks.getDisabledModels.mockRejectedValue(new Error("kv unavailable"));

    const result = await (await getComboModels())("store-down");

    expect(result).toBe(members);
  });

  it("fails open (keeps the member) when the model-alias read rejects for an alias-form member", async () => {
    mocks.getComboForModel.mockResolvedValue({ name: "alias-down", models: ["friendly", "openai/gpt-4o-mini"] });
    mocks.getDisabledModels.mockResolvedValue({ alibaba: ["qwen3"] });
    mocks.getModelAliases.mockRejectedValue(new Error("aliases unavailable"));

    await expect((await getComboModels())("alias-down")).resolves.toEqual(["friendly", "openai/gpt-4o-mini"]);
  });

  it("fails open (keeps the member) when the compatible-node read rejects for a prefixed member", async () => {
    mocks.getComboForModel.mockResolvedValue({ name: "node-down", models: ["team-openai/gpt-4o", "openai/gpt-4o-mini"] });
    mocks.getDisabledModels.mockResolvedValue({ "node-1": ["gpt-4o"] });
    mocks.getProviderNodes.mockRejectedValue(new Error("nodes unavailable"));

    await expect((await getComboModels())("node-down")).resolves.toEqual(["team-openai/gpt-4o", "openai/gpt-4o-mini"]);
  });

  it("preserves non-string legacy members and never passes them through parseModel", async () => {
    const ref = { kind: "combo-ref", name: "nested" };
    const objectTarget = { providerId: "alibaba", model: "qwen3" };
    mocks.getComboForModel.mockResolvedValue({ name: "legacy", models: [ref, objectTarget, null, 7, "alibaba/qwen3"] });
    mocks.getDisabledModels.mockResolvedValue({ ali: ["qwen3"] });

    await expect((await getComboModels())("legacy")).resolves.toEqual([ref, objectTarget, null, 7]);
  });

  it("matches compatible storage ID and configured output prefix without connection state", async () => {
    mocks.getComboForModel.mockResolvedValue({ name: "compatible", models: ["team-openai/gpt-4o", "openai/gpt-4o-mini"] });
    mocks.getProviderNodes.mockResolvedValue([{ id: "node-1", prefix: "team-openai", type: "openai-compatible" }]);
    mocks.getDisabledModels.mockResolvedValue({ "node-1": ["gpt-4o"] });

    await expect((await getComboModels())("compatible")).resolves.toEqual(["openai/gpt-4o-mini"]);
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
  });

  it("resolves configured model aliases before matching disabled rows", async () => {
    mocks.getComboForModel.mockResolvedValue({ name: "aliases", models: ["friendly", "openai/gpt-4o-mini"] });
    mocks.getModelAliases.mockResolvedValue({ friendly: "alibaba/qwen3" });
    mocks.getDisabledModels.mockResolvedValue({ alibaba: ["qwen3"] });

    await expect((await getComboModels())("aliases")).resolves.toEqual(["openai/gpt-4o-mini"]);
  });

  it("keeps recognized all-disabled combos as [] and DB misses as null", async () => {
    mocks.getComboForModel.mockResolvedValue({ name: "empty", models: ["alibaba/qwen3"] });
    mocks.getDisabledModels.mockResolvedValue({ ali: ["qwen3"] });
    const resolve = await getComboModels();

    await expect(resolve("empty")).resolves.toEqual([]);
    mocks.getComboForModel.mockResolvedValue(null);
    await expect(resolve("missing")).resolves.toBeNull();
  });

  it("filters disabled members before hidePaidModels", async () => {
    mocks.getComboForModel.mockResolvedValue({ name: "paid", models: ["alibaba/qwen3", "aug/claude-sonnet-4.6"] });
    mocks.getDisabledModels.mockResolvedValue({ ali: ["qwen3"] });

    await expect((await getComboModels())("paid", true)).resolves.toEqual(["aug/claude-sonnet-4.6"]);
  });

  it("does not dispatch disabled members and empty pools stay terminal 503", async () => {
    mocks.getComboForModel.mockResolvedValue({ name: "dispatch", models: ["alibaba/qwen3", "openai/gpt-4o"] });
    mocks.getDisabledModels.mockResolvedValue({ ali: ["qwen3"] });
    const dispatched = [];
    const ok = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: await (await getComboModels())("dispatch"),
      handleSingleModel: async (_body, model) => { dispatched.push(model); return okResponse(model); },
      log,
      comboName: "dispatch",
      comboStrategy: "fallback",
    });
    expect(dispatched).toEqual(["openai/gpt-4o"]);
    expect(ok.status).toBe(200);

    mocks.getComboForModel.mockResolvedValue({ name: "empty-dispatch", models: ["alibaba/qwen3"] });
    mocks.getDisabledModels.mockResolvedValue({ ali: ["qwen3"] });
    const emptySpy = vi.fn();
    const empty = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: await (await getComboModels())("empty-dispatch"),
      handleSingleModel: emptySpy,
      log,
      comboName: "empty-dispatch",
      comboStrategy: "fallback",
    });
    expect(emptySpy).not.toHaveBeenCalled();
    expect(empty.status).toBe(503);
  });
});
