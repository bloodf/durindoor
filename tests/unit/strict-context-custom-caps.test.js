import { describe, expect, it } from "vitest";
import { getKnownContextWindow, filterByContextRequirements, sortByContextSize } from "../../open-sse/services/combo/contextRequirements.js";
import { materializeRequestModel } from "../../src/sse/services/model.js";
import { clearOpenRouterCatalogCache, resolveOpenRouterModels } from "../../open-sse/services/openrouterCatalog.js";

describe("strict context routing with custom caps map", () => {
  it("uses an explicitly persisted contextWindow from the map", () => {
    const caps = { contextWindow: 200000 };
    Object.defineProperty(caps, "customKeys", { value: new Set(["contextWindow"]), enumerable: false });
    const map = new Map([["prov/custom-x", caps]]);
    expect(getKnownContextWindow("prov/custom-x", map)).toBe(200000);
  });

  it.each([
    ["live", "custom", "organization-large", { capabilities: { contextWindow: 1050000 } }, {}],
    ["shared", "custom", "organization-large", {}, {
      sharedMetadata: { providers: { custom: { "organization-large": { contextWindow: 1050000 } } } },
    }],
    ["curated", "openai", "gpt-6.1-sol", {}, {}],
  ])("uses inherited %s context with no operator keys at filter and sort boundaries", (_source, provider, model, metadata, snapshot) => {
    const member = `${provider}/${model}`;
    const caps = materializeRequestModel(provider, { id: model, kind: "llm", ...metadata }, null, snapshot).capabilities;
    const map = new Map([[member, caps]]);
    const small = "github-models/microsoft/Phi-4";
    const unknown = "custom/no-catalog-entry";
    expect(caps.customKeys.size).toBe(0);
    expect(getKnownContextWindow(member, map)).toBe(1050000);
    expect(filterByContextRequirements([unknown, small, member], {
      minContextWindow: 1050000,
      contextFilterMode: "strict",
    }, null, map)).toEqual([member]);
    expect(filterByContextRequirements([member], {
      minContextWindow: 1050001,
      contextFilterMode: "strict",
    }, null, map)).toEqual([]);
    expect(sortByContextSize([unknown, small, member], {
      preferLargeContext: true,
    }, null, map)).toEqual([member, small, unknown]);
  });

  it("lets an operator ceiling override inherited curated context for eligibility and preference", () => {
    const member = "openai/gpt-6.1-sol";
    const caps = materializeRequestModel("openai", { id: "gpt-6.1-sol", kind: "llm" }, null, {
      customModels: [{
        id: "gpt-6.1-sol",
        providerAlias: "openai",
        capabilities: { contextWindow: 131072 },
      }],
    }).capabilities;
    const larger = "github-models/openai/gpt-4.1";
    const map = new Map([[member, caps]]);
    expect(filterByContextRequirements([member, larger], {
      minContextWindow: 200000,
      contextFilterMode: "strict",
    }, null, map)).toEqual([larger]);
    expect(sortByContextSize([member, larger], {
      preferLargeContext: true,
    }, null, map)).toEqual([larger, member]);
  });

  it("uses OpenRouter's published capacity ahead of inherited family limits while preserving operator precedence", async () => {
    const model = "z-ai/glm-5.2:free";
    const member = `openrouter/${model}`;
    const requirements = { minContextWindow: 100000, contextFilterMode: "strict" };
    clearOpenRouterCatalogCache();
    try {
      await resolveOpenRouterModels({
        fetchImpl: async () => Response.json({ data: [{ id: model, context_length: 32768 }] }),
      });
      const inherited = materializeRequestModel("openrouter", {
        id: model,
        kind: "llm",
        capabilities: { contextWindow: 200000 },
      }).capabilities;
      expect(filterByContextRequirements([member], requirements, null, new Map([
        [member, inherited],
      ]))).toEqual([]);

      const operator = materializeRequestModel("openrouter", { id: model, kind: "llm" }, null, {
        customModels: [{
          id: model,
          providerAlias: "openrouter",
          capabilities: { contextWindow: 131072 },
        }],
      }).capabilities;
      expect(filterByContextRequirements([member], requirements, null, new Map([
        [member, operator],
      ]))).toEqual([member]);
    } finally {
      clearOpenRouterCatalogCache();
    }
  });

  it("strict mode drops unknown members; lenient keeps them", () => {
    const caps = materializeRequestModel("unknownprov", { id: "custom-x", kind: "llm" }).capabilities;
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
