// Port of decolua/9router #4587: Agnes 3.0 Pro seed + vision caps for Agnes 3.0 models.
import { describe, expect, it } from "vitest";
import agnes from "../../open-sse/providers/registry/agnes.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

const caps = (id) => getCapabilitiesForModel("agnes", id);
const ids = () => agnes.models.map((m) => m.id);

describe("agnes-3.0-pro registration", () => {
  it("is seeded with the dotted id and keeps prior ids", () => {
    expect(ids()).toContain("agnes-3.0-pro");
    expect(ids()).not.toContain("agnes-30-pro");
    for (const id of ["agnes-2.5-flash", "agnes-3.0-flash"]) expect(ids(), id).toContain(id);
    expect(new Set(ids()).size).toBe(ids().length);
  });
});

describe("agnes 3.0 capabilities", () => {
  it.each(["agnes-3.0-pro", "agnes-3.0-flash"])("%s claims vision and a 512k window", (id) => {
    expect(caps(id).vision, id).toBe(true);
    expect(caps(id).contextWindow, id).toBe(512000);
  });
  it("3.0 Pro is a reasoning model", () => {
    expect(caps("agnes-3.0-pro").reasoning).toBe(true);
  });
  it("resolves the same through the agnes-ai alias", () => {
    expect(getCapabilitiesForModel("agnes-ai", "agnes-3.0-pro")).toEqual(caps("agnes-3.0-pro"));
  });
});

describe("agnes-3.0-pro pricing", () => {
  it("carries published rates and cache read at 10% of input", () => {
    const p = getPricingForModel("agnes", "agnes-3.0-pro");
    expect(p.input).toBe(0.45);
    expect(p.output).toBe(0.9);
    expect(p.cached).toBeCloseTo(p.input * 0.1, 6);
  });
  it("does not invent a rate for 3.0 Flash", () => {
    expect(getPricingForModel("agnes", "agnes-3.0-flash")).toBeNull();
  });
});
