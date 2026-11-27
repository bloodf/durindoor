import { describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_CAPABILITY_HINTS_META_KEY,
  buildAntigravityCapabilityHintsPsdPatch,
  parseAntigravityCatalogModels,
  reuseAntigravityCapabilityHints,
} from "../../open-sse/services/catalogs/antigravityCatalog.js";

const connection = { id: "ag-1", provider: "antigravity", projectId: "useful-fuze-a1b2c" };
const payload = {
  models: {
    "gemini-4-carbon-medium": {},
    "gemini-4-carbon-disabled": {},
    "gemini-4-carbon-disabled-high": {},
    "tab_flash_lite": {},
    "private-preview": { isInternal: true },
  },
};
const ids = (models) => models.map((model) => model.id);
const reuse = (psd) => reuseAntigravityCapabilityHints({ ...connection, providerSpecificData: psd });

describe("OmniRoute #19878 — uncallable Antigravity discovery stubs", () => {
  it("keeps them out of the live catalog", () => {
    expect(ids(parseAntigravityCatalogModels(payload))).toEqual(["gemini-4-carbon-medium"]);
  });

  it("keeps them out of the cached catalog that replaces the next live probe", () => {
    const patch = buildAntigravityCapabilityHintsPsdPatch(connection, payload);
    expect(patch[ANTIGRAVITY_CAPABILITY_HINTS_META_KEY].model_ids).toEqual(["gemini-4-carbon-medium"]);
    expect(ids(reuse(patch).models)).toEqual(["gemini-4-carbon-medium"]);
  });

  it("filters stubs from hints that were stored before this fix", () => {
    const patch = buildAntigravityCapabilityHintsPsdPatch(connection, payload);
    const stored = {
      [ANTIGRAVITY_CAPABILITY_HINTS_META_KEY]: {
        ...patch[ANTIGRAVITY_CAPABILITY_HINTS_META_KEY],
        model_ids: ["gemini-4-carbon-disabled", "gemini-4-carbon-medium", "tab_flash_lite"],
      },
    };
    expect(ids(reuse(stored).models)).toEqual(["gemini-4-carbon-medium"]);
  });
});
