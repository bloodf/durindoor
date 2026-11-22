import { describe, expect, it } from "vitest";
import { getModelInfoCore, parseModel, resolveModelAliasFromMap, resolveProviderAlias, resolveProviderModelAlias } from "../../open-sse/services/model.js";

describe("prototype keys in model routing", () => {
  for (const key of ["constructor", "toString", "__proto__", "valueOf"]) {
    it(`treats ${key} as an unknown provider and model`, async () => {
      expect(resolveProviderAlias(key)).toBe(key);
      expect(parseModel(`${key}/model`).provider).toBe(key);
      expect(resolveProviderModelAlias(key, "model")).toBe("model");
      expect(resolveProviderModelAlias("github", key)).toBe(key);
      expect(resolveModelAliasFromMap(key, {})).toBeNull();
      await expect(getModelInfoCore(key, {})).resolves.toEqual({ provider: "openai", model: key });
      await expect(getModelInfoCore(`${key}/model`, {})).resolves.toEqual({ provider: key, model: "model" });
    });
  }

  it("resolves explicitly owned prototype-named aliases", async () => {
    const aliases = JSON.parse('{"__proto__":"gh/gemini-3-pro","constructor":"gh/gemini-3-pro"}');
    for (const key of ["__proto__", "constructor"]) {
      await expect(getModelInfoCore(key, aliases)).resolves.toEqual({ provider: "github", model: "gemini-3.1-pro-preview" });
    }
    const inherited = Object.create({ custom: "gh/gemini-3-pro" });
    expect(resolveModelAliasFromMap("custom", inherited)).toBeNull();
  });
});
