import { describe, expect, it } from "vitest";
import { getKnownContextWindow, filterByContextRequirements } from "../../open-sse/services/combo/contextRequirements.js";

describe("strict context routing with custom caps map", () => {
  it("uses an explicitly persisted contextWindow from the map", () => {
    const caps = { contextWindow: 200000 };
    Object.defineProperty(caps, "customKeys", { value: new Set(["contextWindow"]), enumerable: false });
    const map = new Map([["prov/custom-x", caps]]);
    expect(getKnownContextWindow("prov/custom-x", map)).toBe(200000);
  });

  it("keeps unknown models unknown when contextWindow was inherited, not persisted", () => {
    // merged static/default value: present but NOT in customKeys
    const caps = { contextWindow: 128000 };
    Object.defineProperty(caps, "customKeys", { value: new Set(["vision"]), enumerable: false });
    const map = new Map([["unknownprov/custom-x", caps]]);
    // unknownprov has no registry entry, so the catalog fallback yields null -> unknown
    expect(getKnownContextWindow("unknownprov/custom-x", map)).toBeNull();
  });

  it("strict mode drops unknown members; lenient keeps them", () => {
    const caps = { contextWindow: 128000 };
    Object.defineProperty(caps, "customKeys", { value: new Set([]), enumerable: false });
    const map = new Map([["unknownprov/custom-x", caps]]);
    const strict = filterByContextRequirements(["unknownprov/custom-x"], { minContextWindow: 100000, contextFilterMode: "strict" }, null, map);
    expect(strict).toEqual([]);
    const lenient = filterByContextRequirements(["unknownprov/custom-x"], { minContextWindow: 100000, contextFilterMode: "lenient" }, null, map);
    expect(lenient).toEqual(["unknownprov/custom-x"]);
  });
});


describe("customKeys marker never leaks", () => {
  it("is non-enumerable and absent from JSON", async () => {
    const { resolveCustomCapabilities } = await import("../../src/sse/services/model.js");
    const caps = resolveCustomCapabilities("openai", "my-m", null, [{ id: "my-m", providerAlias: "openai", capabilities: { vision: true } }]);
    expect(caps.customKeys).toBeInstanceOf(Set);
    expect(JSON.parse(JSON.stringify(caps)).customKeys).toBeUndefined();
    expect(Object.keys(caps)).not.toContain("customKeys");
  });
});
