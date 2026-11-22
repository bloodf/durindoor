import { describe, expect, it } from "vitest";
import { passthroughAliasModels } from "../../src/shared/utils/passthroughAliasModels.js";

describe("passthrough model aliases", () => {
  it("finds canonical and short provider prefixes without matching other providers", () => {
    expect(passthroughAliasModels({
      canonical: "provider-long/model-a",
      short: "short/model-b",
      other: "provider-longer/model-c",
      invalid: null,
    }, "provider-long", "short")).toEqual([
      { id: "model-a", name: "canonical", value: "provider-long/model-a" },
      { id: "model-b", name: "short", value: "short/model-b" },
    ]);
  });
});
