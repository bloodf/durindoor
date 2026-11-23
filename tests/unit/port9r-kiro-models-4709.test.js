import { describe, expect, it } from "vitest";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

describe("Kiro MITM model choices", () => {
  it("offers the MiniMax M2.5 and GLM 5 aliases", () => {
    expect(MITM_TOOLS.kiro.defaultModels).toEqual(expect.arrayContaining([
      { id: "minimax-m2.5", name: "MiniMax M2.5", alias: "minimax-m2.5" },
      { id: "glm-5", name: "GLM 5", alias: "glm-5" },
    ]));
  });
});
