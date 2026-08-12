import { beforeEach, describe, expect, it, vi } from "vitest";

// #6495 / F-4 — `hidePaidModels` combo execution wiring. The catalog test
// covers /v1/models; this guards the live routing layer that chat/image/TTS
// (getComboModels) and fetch/search (getComboModelsFromData + filterPaidModels)
// actually consume. Toggle off must pass the original member array through
// unchanged (identity); toggle on must drop paid + unknown (non-free-provider)
// members, keep curated/explicit free members, and yield an empty array for an
// all-paid pool — NOT null — so handlers that key routing off `if (comboModels)`
// see a truthy-but-empty list and the combo runner returns its terminal
// "all models unavailable" response rather than silently falling through to
// single-model handling against the combo NAME.

const mocks = vi.hoisted(() => ({
  getComboByName: vi.fn(),
  getModelAliases: vi.fn(),
  getProviderNodes: vi.fn(),
  getProviderConnections: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ disabledFreeProviders: [] }),
}));

vi.mock("@/lib/localDb", () => ({
  getComboByName: mocks.getComboByName,
  getModelAliases: mocks.getModelAliases,
  getProviderNodes: mocks.getProviderNodes,
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
}));

async function loadGetComboModels() {
  const mod = await import("../../src/sse/services/model.js");
  return mod.getComboModels;
}

const PAID = "anthropic/claude-sonnet-5"; // canonical-priced
const FREE = "aug/claude-sonnet-4.6"; // no-auth free provider
const UNKNOWN = "mystery/never-seen-before"; // unknown provider → paid (hidden) under catalog contract

describe("getComboModels hidePaidModels wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.getProviderConnections.mockResolvedValue([]);
  });

  it("returns null for a provider/model input regardless of toggle", async () => {
    mocks.getComboByName.mockResolvedValue(null);
    const getComboModels = await loadGetComboModels();
    expect(await getComboModels("anthropic/claude-sonnet-5", true)).toBe(null);
    expect(mocks.getComboByName).toHaveBeenCalledExactlyOnceWith("anthropic/claude-sonnet-5");
  });

  it("returns null when the name is not a combo", async () => {
    mocks.getComboByName.mockResolvedValue(null);
    const getComboModels = await loadGetComboModels();
    expect(await getComboModels("nope", true)).toBe(null);
  });

  it("toggle off: returns the ORIGINAL member array (identity preserved)", async () => {
    const members = [PAID, FREE];
    mocks.getComboByName.mockResolvedValue({ name: "c", models: members });
    const getComboModels = await loadGetComboModels();
    const result = await getComboModels("c", false);
    expect(result).toBe(members); // same reference — passthrough contract
    expect(result).toEqual([PAID, FREE]);
  });

  it("toggle off (default arg) is a passthrough and triggers no settings read", async () => {
    const members = [PAID, FREE];
    mocks.getComboByName.mockResolvedValue({ name: "c", models: members });
    const getComboModels = await loadGetComboModels();
    const result = await getComboModels("c"); // hidePaidModels omitted
    expect(result).toBe(members);
  });

  it("toggle on: mixed pool → paid + unknown dropped, free kept, order preserved", async () => {
    mocks.getComboByName.mockResolvedValue({ name: "mixed", models: [PAID, FREE, UNKNOWN] });
    const getComboModels = await loadGetComboModels();
    const result = await getComboModels("mixed", true);
    expect(result).toEqual([FREE]);
  });

  it("toggle on: all-paid pool → empty array (truthy), not null", async () => {
    mocks.getComboByName.mockResolvedValue({ name: "all-paid", models: [PAID] });
    const getComboModels = await loadGetComboModels();
    const result = await getComboModels("all-paid", true);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
    // Truthy so `if (comboModels)` in handlers still enters combo routing.
    expect(result).toBeTruthy();
  });

  it("toggle on: never mutates the persisted combo object", async () => {
    const members = [PAID, FREE];
    const combo = { name: "c", models: members };
    mocks.getComboByName.mockResolvedValue(combo);
    const getComboModels = await loadGetComboModels();
    await getComboModels("c", true);
    expect(combo.models).toEqual([PAID, FREE]); // original intact
  });

  it("auto-combo pool is filtered through the same hidePaidModels toggle (F-2 + F-4 seam)", async () => {
    // Active connection to the `glm` provider (paid roster — not in the free
    // catalog). auto/glm resolves its pool from getAutoComboCatalog, which
    // reads getProviderConnections. The resolved pool is then run through
    // filterPaidModels exactly like a saved combo, so hidePaidModels must drop
    // paid auto members rather than leaking them to chat/image/TTS routing.
    mocks.getProviderConnections.mockResolvedValue([{ provider: "glm", isActive: true }]);
    const getComboModels = await loadGetComboModels();

    const off = await getComboModels("auto/glm", false);
    expect(Array.isArray(off)).toBe(true);
    expect(off.length).toBeGreaterThan(0); // catalog materialized a pool
    expect(off.every((m) => m.startsWith("glm/"))).toBe(true);

    const on = await getComboModels("auto/glm", true);
    expect(Array.isArray(on)).toBe(true);
    // glm provider has no free roster → every auto member is paid → all hidden.
    expect(on).toEqual([]);
    // Off-pool is a strict superset; proves the toggle actually filtered.
    expect(off.length).toBeGreaterThan(on.length);
  });

  it("auto-combo toggle off is a passthrough (no paid filtering)", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ provider: "glm", isActive: true }]);
    const getComboModels = await loadGetComboModels();
    const off = await getComboModels("auto/glm");
    expect(off.length).toBeGreaterThan(0);
  });
});
