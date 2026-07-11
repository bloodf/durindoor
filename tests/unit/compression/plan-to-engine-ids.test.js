import { describe, expect, it } from "vitest";
import { planToEngineIds } from "../../../open-sse/services/compression/index.js";

describe("planToEngineIds (F-1d)", () => {
  it("returns [] for null/undefined", () => {
    expect(planToEngineIds(null)).toEqual([]);
    expect(planToEngineIds(undefined)).toEqual([]);
  });

  it("unwraps a { plan } wrapper identically to a raw plan", () => {
    const raw = { mode: "stacked", stackedPipeline: [{ engine: "caveman" }, { engine: "headroom" }] };
    expect(planToEngineIds({ plan: raw })).toEqual(["caveman", "headroom"]);
    expect(planToEngineIds(raw)).toEqual(["caveman", "headroom"]);
  });

  it("preserves stacked-pipeline order and drops falsy engines", () => {
    const plan = {
      mode: "stacked",
      stackedPipeline: [
        { engine: "session-dedup" },
        { engine: "" },
        { engine: null },
        { engine: "headroom" },
        {},
        { engine: "caveman" },
      ],
    };
    expect(planToEngineIds(plan)).toEqual(["session-dedup", "headroom", "caveman"]);
  });

  it("reverse-maps single-mode plans to the engine id", () => {
    expect(planToEngineIds({ mode: "lite", stackedPipeline: [] })).toEqual(["lite"]);
    expect(planToEngineIds({ mode: "standard", stackedPipeline: [] })).toEqual(["caveman"]);
    expect(planToEngineIds({ mode: "aggressive", stackedPipeline: [] })).toEqual(["aggressive"]);
    expect(planToEngineIds({ mode: "ultra", stackedPipeline: [] })).toEqual(["ultra"]);
    expect(planToEngineIds({ mode: "rtk", stackedPipeline: [] })).toEqual(["rtk"]);
  });

  it("returns [] for off mode and unknown modes", () => {
    expect(planToEngineIds({ mode: "off", stackedPipeline: [] })).toEqual([]);
    expect(planToEngineIds({ mode: "nope", stackedPipeline: [] })).toEqual([]);
    expect(planToEngineIds({ stackedPipeline: [] })).toEqual([]);
  });
});
