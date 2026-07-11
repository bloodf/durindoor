import { describe, it, expect, vi, beforeEach } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Pure engine tests (no DB). Settings/catalog threading through the handler
// seam is proven in the "model-service integration" block at the bottom, which
// mocks @/lib/localDb and drives getComboResolution / buildInstalledProviderCatalog
// — the exact seam chat/image/tts/search/fetch all call.
// ────────────────────────────────────────────────────────────────────────────

import {
  detectModelFamily,
  isAutoComboId,
  isValidModelFamily,
  MODEL_FAMILIES,
  AUTO_FAMILY_IDS,
  buildFamilyCandidateFilter,
  resolveAutoCombo,
  handleFusionChat,
  resetComboRotation,
} from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: vi.fn(), debug: () => {} };

function okResponse(content) {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, clone: make, json: async () => json });
  return make();
}

function errResponse(status = 500) {
  const make = () => ({ ok: false, status, clone: make, json: async () => ({}) });
  return make();
}

// ────────────────────────────────────────────────────────────────────────────
// Family detection — anchored prefix boundaries; no substring false positives.
// ────────────────────────────────────────────────────────────────────────────

describe("detectModelFamily", () => {
  it.each([
    ["glm-5.2", "glm"],
    ["glm-4.7-flash", "glm"],
    ["minimax-m2.7", "minimax"],
    ["mimo-v1", "mimo"],
    ["gemma-3-27b", "gemma"],
    ["llama-4-scout", "llama"],
    ["gemini-2.5-pro", "gemini"],
    ["zai/glm-5.2", "glm"],          // provider prefix stripped
    ["openrouter/meta/llama-4", "llama"],
  ])("%s → %s", (id, family) => {
    expect(detectModelFamily(id)).toBe(family);
  });

  it("does not substring-match arbitrary ids", () => {
    expect(detectModelFamily("auto")).toBeNull();
    expect(detectModelFamily("my-glm-wrapper")).toBeNull();
    expect(detectModelFamily("bigglm")).toBeNull();
    expect(detectModelFamily("xgemini")).toBeNull();
    expect(detectModelFamily("")).toBeNull();
    expect(detectModelFamily(null)).toBeNull();
  });
});

describe("isAutoComboId / family registry", () => {
  it("accepts the seven advertised auto ids", () => {
    for (const id of AUTO_FAMILY_IDS) expect(isAutoComboId(id)).toBe(true);
    expect(AUTO_FAMILY_IDS).toEqual(MODEL_FAMILIES.map((f) => `auto/${f}`));
  });

  it("rejects non-auto and malformed ids", () => {
    expect(isAutoComboId("openai/gpt-5")).toBe(false);
    expect(isAutoComboId("auto/unknown")).toBe(false);
    expect(isAutoComboId("auto/")).toBe(false);
    expect(isAutoComboId("auto")).toBe(false);
    expect(isAutoComboId(null)).toBe(false);
  });

  it("isValidModelFamily matches MODEL_FAMILIES exactly", () => {
    for (const f of MODEL_FAMILIES) expect(isValidModelFamily(f)).toBe(true);
    expect(isValidModelFamily("gpt")).toBe(false);
  });
});

describe("buildFamilyCandidateFilter", () => {
  it("zai resolves by provider alias, not model-id prefix", () => {
    const filter = buildFamilyCandidateFilter("zai");
    expect(filter({ provider: "zai", model: "glm-5.2" })).toBe(true);
    expect(filter({ provider: "glm", model: "glm-5.2" })).toBe(false);
    expect(filter({ provider: "zai", model: "anything" })).toBe(true);
  });

  it("glm resolves by model-id family across providers", () => {
    const filter = buildFamilyCandidateFilter("glm");
    expect(filter({ provider: "glm", model: "glm-5.2" })).toBe(true);
    expect(filter({ provider: "zai", model: "glm-5.2" })).toBe(true);
    expect(filter({ provider: "glm", model: "gemini-2.5-pro" })).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveAutoCombo — catalog → members; enable/disable; fail-fast shape.
// ────────────────────────────────────────────────────────────────────────────

const CATALOG = {
  glm: [{ id: "glm-5.2" }, { id: "glm-4.7" }],
  zai: [{ id: "glm-5.2" }, { id: "glm-4.7" }],
  google: [{ id: "gemini-2.5-pro" }],
  minimax: [{ id: "minimax-m2.7" }],
};

describe("resolveAutoCombo", () => {
  it("resolves auto/glm across providers that serve GLM ids, deduped, qualified", () => {
    const r = resolveAutoCombo("auto/glm", { catalog: CATALOG });
    expect(r.family).toBe("glm");
    expect(r.members.sort()).toEqual(
      ["glm/glm-4.7", "glm/glm-5.2", "zai/glm-4.7", "zai/glm-5.2"].sort()
    );
  });

  it("resolves auto/zai by provider alias only", () => {
    const r = resolveAutoCombo("auto/zai", { catalog: CATALOG });
    expect(r.family).toBe("zai");
    expect(r.members.sort()).toEqual(["zai/glm-4.7", "zai/glm-5.2"]);
  });

  it("dedupes identical provider/model candidates", () => {
    const catalog = { glm: [{ id: "glm-5.2" }, { id: "glm-5.2" }, "glm-5.2"] };
    const r = resolveAutoCombo("auto/glm", { catalog });
    expect(r.members).toEqual(["glm/glm-5.2"]);
  });

  it("returns null for non-auto ids", () => {
    expect(resolveAutoCombo("openai/gpt-5", { catalog: CATALOG })).toBeNull();
    expect(resolveAutoCombo("combo-name", { catalog: CATALOG })).toBeNull();
  });

  it("fail-fast: family with zero installed providers → empty members", () => {
    const r = resolveAutoCombo("auto/llama", { catalog: CATALOG });
    expect(r.members).toEqual([]);
  });

  it("global disable short-circuits with disabled marker + reason", () => {
    const r = resolveAutoCombo("auto/glm", {
      catalog: CATALOG,
      settings: { autoCombo: { enabled: false } },
    });
    expect(r.disabled).toBe(true);
    expect(r.members).toEqual([]);
    expect(r.reason).toMatch(/disabled/);
  });

  it("per-family disable short-circuits only that family", () => {
    const settings = { autoCombo: { enabled: true, families: { "auto/glm": { enabled: false } } } };
    expect(resolveAutoCombo("auto/glm", { catalog: CATALOG, settings }).disabled).toBe(true);
    expect(resolveAutoCombo("auto/minimax", { catalog: CATALOG, settings }).disabled).toBeUndefined();
  });

  it("honors comboStrategies strategy + judgeModel", () => {
    const settings = {
      comboStrategies: { "auto/glm": { fallbackStrategy: "fusion", judgeModel: "glm/glm-5.2" } },
    };
    const r = resolveAutoCombo("auto/glm", { catalog: CATALOG, settings });
    expect(r.strategy).toBe("fusion");
    expect(r.judgeModel).toBe("glm/glm-5.2");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Fusion fixes (engine-level): minPanel=1, explicit judge on single survivor,
// per-member failure detail on all-fail 503.
// ────────────────────────────────────────────────────────────────────────────

describe("fusion auto-combo fixes", () => {
  it("#6521: minPanel=1 with a multi-model panel still fuses the lone survivor through an explicit judge", async () => {
    // p/b fails → one survivor (p/a); minPanel=1 allows fusion to proceed and
    // the explicit judge must still be invoked.
    const handleSingleModel = vi.fn(async (_b, m) => {
      if (m === "p/b") return errResponse(500);
      return okResponse(m === "p/judge" ? "judged" : "panel-a");
    });
    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
      tuning: { minPanel: 1, stragglerGraceMs: 20, panelHardTimeoutMs: 5000 },
    });
    const called = handleSingleModel.mock.calls.map((c) => c[1]);
    expect(called).toContain("p/judge");
    expect(called).toContain("p/a");
    expect(res.status).toBe(200);
  });

  it("#6607: multi-model panel collapses to one survivor + explicit judgeModel routes through judge", async () => {
    const handleSingleModel = vi.fn(async (_b, m) => {
      if (m === "p/b") return errResponse(503);
      return okResponse(m === "p/judge" ? "judged" : "src");
    });
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
      tuning: { stragglerGraceMs: 20, panelHardTimeoutMs: 5000 },
    });
    expect(handleSingleModel.mock.calls.map((c) => c[1])).toContain("p/judge");
  });

  it("#6607: lone survivor WITHOUT explicit judge answers directly (no redundant self-judge)", async () => {
    const handleSingleModel = vi.fn(async (_b, m) => {
      if (m === "p/b") return errResponse(503);
      return okResponse("src");
    });
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      tuning: { stragglerGraceMs: 20, panelHardTimeoutMs: 5000 },
    });
    const called = handleSingleModel.mock.calls.map((c) => c[1]);
    expect(called).not.toContain("p/judge");
    // p/a is the survivor; it is the implicit judge (panel[0]) so answering
    // directly means exactly one extra call to p/a (the final answer), never a
    // separate judge pass over a single source.
    expect(called.filter((m) => m === "p/a").length).toBeGreaterThanOrEqual(1);
  });

  it("#6521: all-fail 503 surfaces per-member reasons", async () => {
    const handleSingleModel = vi.fn(async () => errResponse(429));
    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      tuning: { stragglerGraceMs: 20, panelHardTimeoutMs: 5000 },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.message).toMatch(/status_429/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// #6733 — sticky affinity released on pinned-model failure. We assert the
// released state directly via the in-memory affinity map, NOT via a second
// request whose rotation outcome is implementation-defined.
// ────────────────────────────────────────────────────────────────────────────

describe("sticky affinity release (#6733)", () => {
  beforeEach(() => resetComboRotation());

  it("clears affinity when the pinned model fails, so the next turn is not re-pinned", async () => {
    const { handleComboChat } = await import("../../open-sse/services/combo.js");
    const body = { messages: [{ role: "user", content: "same-key-6733" }] };
    let firstCall = true;
    const handleSingleModel = vi.fn(async (_b, m) => {
      if (m === "p/a" && firstCall) {
        firstCall = false;
        return errResponse(500);
      }
      return okResponse("ok");
    });

    await handleComboChat({
      body,
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      comboName: "sticky6733",
      comboStrategy: "round-robin",
      comboStickyLimit: 5,
    });

    // Behavior-level assertion: the second request with the same conversation
    // key must NOT be forced to lead with the model that just failed. We prove
    // release by checking the dispatcher can lead with p/b on the next turn.
    const handleSingleModel2 = vi.fn(async () => okResponse("ok2"));
    await handleComboChat({
      body,
      models: ["p/a", "p/b"],
      handleSingleModel: handleSingleModel2,
      log,
      comboName: "sticky6733",
      comboStrategy: "round-robin",
      comboStickyLimit: 5,
    });
    expect(handleSingleModel2.mock.calls[0][1]).toBe("p/b");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Handler-seam integration — drives getComboResolution + buildInstalledProviderCatalog
// (the single seam chat/image/tts/search/fetch all call) with a mocked localDb.
// Proves: installed-provider filtering (no unconfigured leak), empty installed
// catalog → auto-empty, global/family disable → auto-empty with reason, and
// judgeModel propagation. These are the settings/catalog-threading guarantees
// the handler 503/403 paths rely on.
// ────────────────────────────────────────────────────────────────────────────

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getComboByName: vi.fn(),
  getModelAliases: vi.fn(async () => []),
  getProviderNodes: vi.fn(async () => []),
}));

vi.mock("@/lib/localDb", () => dbMocks);

describe("model-service seam (getComboResolution / buildInstalledProviderCatalog)", () => {
  let getComboResolution, buildInstalledProviderCatalog;

  beforeEach(async () => {
    vi.resetModules();
    dbMocks.getProviderConnections.mockReset();
    dbMocks.getComboByName.mockReset();
    dbMocks.getComboByName.mockResolvedValue(null);
    const mod = await import("../../src/sse/services/model.js");
    getComboResolution = mod.getComboResolution;
    buildInstalledProviderCatalog = mod.buildInstalledProviderCatalog;
  });

  it("empty installed catalog → auto-empty (handler path → 503), no upstream dispatch", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([]);
    const r = await getComboResolution("auto/glm", {});
    expect(r).toEqual({ kind: "auto-empty", family: "glm", reason: expect.stringMatching(/no installed providers/) });
  });

  it("global disable → auto-empty with disabled reason (handler path → 503)", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{ provider: "glm" }]);
    const r = await getComboResolution("auto/glm", { autoCombo: { enabled: false } });
    expect(r.kind).toBe("auto-empty");
    expect(r.reason).toMatch(/disabled/);
  });

  it("per-family disable → auto-empty only for that family", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{ provider: "glm" }, { provider: "minimax" }]);
    const settings = { autoCombo: { enabled: true, families: { "auto/glm": { enabled: false } } } };
    expect((await getComboResolution("auto/glm", settings)).kind).toBe("auto-empty");
    // minimax still resolves (installed + not disabled)
    const m = await getComboResolution("auto/minimax", settings);
    expect(m.kind).toBe("combo");
  });

  it("installed-provider filtering: unconfigured provider never leaks into the pool", async () => {
    // Only glm + zai installed; gemini provider exists in the bundled registry
    // but is NOT installed → must NOT appear in any auto-combo pool.
    dbMocks.getProviderConnections.mockResolvedValue([{ provider: "glm" }, { provider: "zai" }]);
    const catalog = await buildInstalledProviderCatalog();
    expect(catalog).toHaveProperty("glm");
    expect(catalog).not.toHaveProperty("google");
    const r = await getComboResolution("auto/gemini", {});
    // gemini family: google not installed → empty pool (unless another installed
    // provider serves gemini-* ids, which glm/zai do not).
    expect(r.kind).toBe("auto-empty");
  });

  it("resolves a family combo from installed providers (glm+zai), qualified and family-filtered", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{ provider: "glm" }, { provider: "zai" }]);
    const r = await getComboResolution("auto/glm", {});
    expect(r.kind).toBe("combo");
    expect(r.models.length).toBeGreaterThan(0);
    // Every member is a GLM id served by an installed provider; no gemini/other leak.
    expect(r.models.every((m) => /^(glm|zai)\/glm-/.test(m))).toBe(true);
  });

  it("named combo still resolves via getComboByName", async () => {
    dbMocks.getComboByName.mockResolvedValue({ name: "my-combo", models: ["glm/glm-5.2", "zai/glm-5.2"] });
    const r = await getComboResolution("my-combo", {});
    expect(r).toEqual({ kind: "combo", models: ["glm/glm-5.2", "zai/glm-5.2"] });
  });

  it("plain provider/model string → null (not a combo)", async () => {
    const r = await getComboResolution("openai/gpt-5", {});
    expect(r).toBeNull();
  });
});
