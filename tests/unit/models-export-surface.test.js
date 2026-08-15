import { describe, expect, it } from "vitest";
import * as models from "../../src/models/index.js";

describe("model module export surface", () => {
  it("exports the complete custom-model CRUD contract", () => {
    expect(models.getCustomModels).toBeTypeOf("function");
    expect(models.addCustomModel).toBeTypeOf("function");
    expect(models.updateCustomModel).toBeTypeOf("function");
    expect(models.deleteCustomModel).toBeTypeOf("function");
  });
});
