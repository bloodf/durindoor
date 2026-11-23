import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as modelList from "../../src/app/api/v1/models/buildModelsList.js";

describe("model list public entry", () => {
  it("preserves its named exports", () => {
    expect(Object.keys(modelList).sort()).toEqual(["LLM_KIND", "buildModelsList", "readCompatibleContextLength", "resolveCompatibleCatalog"]);
    expect(modelList.LLM_KIND).toBe("llm");
    expect(modelList.buildModelsList).toBeTypeOf("function");
    expect(modelList.resolveCompatibleCatalog).toBeTypeOf("function");
  });

  it("keeps the public entry under 300 lines", () => {
    const source = readFileSync(new URL("../../src/app/api/v1/models/buildModelsList.js", import.meta.url), "utf8");
    expect(source.split("\n").length).toBeLessThan(300);
  });
});
