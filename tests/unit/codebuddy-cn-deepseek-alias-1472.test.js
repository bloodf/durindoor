// #1472: the CodeBuddy CN catalog sync retired deepseek-v4-flash; saved configs
// keep resolving to deepseek-v4.1-flash.
import { describe, expect, it } from "vitest";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

describe("#1472 CodeBuddy CN deepseek-v4-flash alias", () => {
  it("routes the retired id to its successor", () => {
    expect(getModelUpstreamId("codebuddy-cn", "deepseek-v4-flash")).toBe("deepseek-v4.1-flash");
    expect(getModelUpstreamId("cbcn", "deepseek-v4-flash")).toBe("deepseek-v4.1-flash");
    expect(getModelUpstreamId("codebuddy-cn", "deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
  });
});
