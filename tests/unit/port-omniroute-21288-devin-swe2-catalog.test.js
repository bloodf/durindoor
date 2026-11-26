import { describe, expect, it } from "vitest";

import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";

// Ids are the upstream `model_uid` spellings; Devin has no bare `swe-2` or `swe-2-flash`.
const QUALITY = ["max", "xhigh", "high", "medium", "low"];
const SHORT = ["max", "high", "medium"];
const withEfforts = (base, efforts, suffix = "") => efforts.map((effort) => `${base}-${effort}${suffix}`);

const SWE_2_IDS = [
  "swe-2-1",
  ...withEfforts("swe-2-1", QUALITY),
  "swe-2-1-lightning",
  ...withEfforts("swe-2-1", QUALITY, "-lightning"),
  ...withEfforts("swe-2", SHORT),
  ...withEfforts("swe-2", SHORT, "-lightning"),
  ...withEfforts("swe-2-flash", SHORT),
  ...withEfforts("swe-2-flash", SHORT, "-lightning"),
];

describe("OmniRoute #21288 (15c2403d2bdb) Devin SWE-2.x catalog", () => {
  const models = getModelsByProviderId("devin-desktop");
  const byId = new Map(models.map((model) => [model.id, model]));

  it("lists the whole SWE-2.x family once, in upstream order", () => {
    expect(models.map(({ id }) => id).filter((id) => id.startsWith("swe-2"))).toEqual(SWE_2_IDS);
  });

  it.each([
    ["swe-2-1", "SWE-2.1", 65536, 262144],
    ["swe-2-1-xhigh", "SWE-2.1 XHigh", 65536, 262144],
    ["swe-2-1-max-lightning", "SWE-2.1 Ultrafast Max", 65536, 262144],
    ["swe-2-high", "SWE-2 High", 128000, 262000],
    ["swe-2-high-lightning", "SWE-2 High Ultrafast", 128000, 262144],
    ["swe-2-flash-medium", "SWE-2 Flash Medium", 131072, 262144],
    ["swe-2-flash-max-lightning", "SWE-2 Flash Max Ultrafast", 131072, 262144],
  ])("gives %s its upstream name and limits", (id, name, maxOutputTokens, contextLength) => {
    expect(byId.get(id)).toMatchObject({ name, maxOutputTokens, contextLength });
  });
});
