import { describe, it, expect } from "vitest";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

// #4940: DeepSeek's API accepts only "deepseek-flash" and "deepseek-v4-pro".
// The catalog id stays "deepseek-v4.1-flash" (what clients ask for), but the
// request that leaves 9router must carry the name the upstream understands.
describe("DeepSeek V4.1 Flash upstream model id (#4940)", () => {
  it("maps deepseek-v4.1-flash to the name DeepSeek actually serves (alias of deepseek-flash)", () => {
    expect(getModelUpstreamId("deepseek", "deepseek-v4.1-flash")).toBe("deepseek-flash");
  });

  it("does not touch models that the upstream already accepts", () => {
    expect(getModelUpstreamId("deepseek", "deepseek-v4-pro")).toBe("deepseek-v4-pro");
  });
});
