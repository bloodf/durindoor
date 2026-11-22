// Port of decolua/9router #1936 (translator part): camelCase `reasoningEffort`
// is read as thinking intent and takes precedence over snake_case.
import { describe, expect, it } from "vitest";
import { extractThinking } from "open-sse/translator/concerns/thinkingUnified.js";

describe("extractThinking reasoningEffort alias (#1936)", () => {
  it("reads camelCase reasoningEffort", () => {
    expect(extractThinking({ reasoningEffort: "high" })).toEqual({ mode: "level", level: "high" });
  });

  it("prefers camelCase over snake_case", () => {
    expect(extractThinking({ reasoningEffort: "low", reasoning_effort: "high" })).toEqual({ mode: "level", level: "low" });
  });

  it("maps off/none/auto the same as snake_case", () => {
    expect(extractThinking({ reasoningEffort: "none" })).toEqual({ mode: "none" });
    expect(extractThinking({ reasoningEffort: "auto" })).toEqual({ mode: "auto" });
  });

  it("still reads snake_case when camelCase is absent", () => {
    expect(extractThinking({ reasoning_effort: "medium" })).toEqual({ mode: "level", level: "medium" });
  });
});
