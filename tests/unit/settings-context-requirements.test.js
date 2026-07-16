import { beforeEach, describe, expect, it, vi } from "vitest";

// Behavioral coverage for the comboStrategies.contextRequirements settings PATCH
// validation (upstream #6907 schema parity): integer minContextWindow 0..10M,
// boolean preferLargeContext, enum contextFilterMode, and rejection of unknown
// keys. updateSettings must NOT be called when validation fails.

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
  resetComboScoring: mocks.resetComboScoring,
}));

import { PATCH } from "../../src/app/api/settings/route.js";

function req(body) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("settings PATCH comboStrategies.contextRequirements validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSettings.mockResolvedValue({});
  });

  it("accepts a valid contextRequirements object and calls updateSettings", async () => {
    const res = await PATCH(
      req({
        comboStrategies: {
          "auto/my-combo": {
            contextRequirements: { minContextWindow: 128000, preferLargeContext: true, contextFilterMode: "strict" },
          },
        },
      })
    );
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
  });

  it("accepts a combo config without contextRequirements (untouched)", async () => {
    const res = await PATCH(req({ comboStrategies: { "auto/x": { strategy: "smart-scoring" } } }));
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
  });

  it("coerces a numeric-string minContextWindow to a number (upstream z.coerce.number())", async () => {
    const res = await PATCH(req({ comboStrategies: { "auto/c": { contextRequirements: { minContextWindow: "128000" } } } }));
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    // PATCH mutates the parsed clone it persists — inspect the persisted argument.
    const persisted = mocks.updateSettings.mock.calls[0][0];
    expect(persisted.comboStrategies["auto/c"].contextRequirements.minContextWindow).toBe(128000);
  });

  it.each([
    { minContextWindow: -1 },
    { minContextWindow: 20_000_000 }, // > 10_000_000
    { minContextWindow: 128.5 }, // not an integer
    { minContextWindow: "128.5" }, // coerced but not an integer
    { minContextWindow: "abc" }, // coerces to NaN
    { preferLargeContext: "yes" }, // not a boolean
    { contextFilterMode: "permissive" }, // not in enum
    { contextFilterMode: "STRICT" }, // case-sensitive enum
    { unknownKey: 1 }, // unknown key (upstream .strict())
    { minContextWindow: 128000, bogus: true }, // mixed valid + unknown
  ])("rejects invalid contextRequirements %j with 400 and does NOT persist", async (cr) => {
    const res = await PATCH(req({ comboStrategies: { "auto/c": { contextRequirements: cr } } }));
    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects explicit null contextRequirements (upstream .strict().optional() rejects null)", async () => {
    const res = await PATCH(req({ comboStrategies: { "auto/c": { contextRequirements: null } } }));
    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects null comboStrategies with 400 (no Object.values crash)", async () => {
    const res = await PATCH(req({ comboStrategies: null }));
    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-object contextRequirements with 400", async () => {
    const res = await PATCH(req({ comboStrategies: { "auto/c": { contextRequirements: "nope" } } }));
    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
