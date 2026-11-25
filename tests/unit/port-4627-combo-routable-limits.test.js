import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));

import * as localDb from "@/lib/localDb";
import { aggregateComboCapabilities } from "../../open-sse/providers/capabilities.js";
import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";

const ALIASES = { cc: "claude", openai: "openai" };
const limitsOf = (members) => aggregateComboCapabilities(members, null, ALIASES).contextWindow;

const OPENAI_SMALL = "openai/gpt-4";
const CLAUDE_LARGE = "cc/claude-opus-4-7";

const claudeOnly = [{ id: "conn-claude", provider: "claude", isActive: true, providerSpecificData: { enabledModels: ["claude-opus-4-7"] } }];

async function comboEntry(combos, connections = claudeOnly, name = "mixed") {
  localDb.getProviderConnections.mockResolvedValue(connections);
  localDb.getCombos.mockResolvedValue(combos);
  const models = await buildModelsList(["llm"]);
  return models.find((model) => model.id === name);
}

describe("combo limits ignore unconnected provider seats (upstream decolua/9router#4627)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("publishes the connected seat's limits instead of an unconnected seat's smaller ones", async () => {
    expect(limitsOf([OPENAI_SMALL])).toBeLessThan(limitsOf([CLAUDE_LARGE]));

    const entry = await comboEntry([{ name: "mixed", models: [OPENAI_SMALL, CLAUDE_LARGE] }]);

    expect(entry.context_length).toBe(limitsOf([CLAUDE_LARGE]));
    expect(entry.capabilities.contextWindow).toBe(entry.context_length);
  });

  it("ignores a disabled connection's seat", async () => {
    const entry = await comboEntry(
      [{ name: "mixed", models: [OPENAI_SMALL, CLAUDE_LARGE] }],
      [...claudeOnly, { id: "conn-openai", provider: "openai", isActive: false }],
    );

    expect(entry.context_length).toBe(limitsOf([CLAUDE_LARGE]));
  });

  it("keeps the smallest limit when every seat is connected", async () => {
    const entry = await comboEntry(
      [{ name: "mixed", models: [OPENAI_SMALL, CLAUDE_LARGE] }],
      [...claudeOnly, { id: "conn-openai", provider: "openai", isActive: true, providerSpecificData: { enabledModels: ["gpt-4"] } }],
    );

    expect(entry.context_length).toBe(limitsOf([OPENAI_SMALL]));
  });

  it("skips a nested combo that has no connected seat", async () => {
    const entry = await comboEntry([
      { name: "mixed", models: ["inner", CLAUDE_LARGE] },
      { name: "inner", models: [OPENAI_SMALL] },
    ]);

    expect(entry.context_length).toBe(limitsOf([CLAUDE_LARGE]));
  });

  it("falls back to every seat when no seat is connected", async () => {
    const entry = await comboEntry([{ name: "mixed", models: [OPENAI_SMALL] }]);

    expect(entry.context_length).toBe(limitsOf([OPENAI_SMALL]));
  });
});
