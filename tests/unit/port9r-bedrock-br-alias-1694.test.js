import { describe, expect, it } from "vitest";
import { resolveProviderAlias, parseModel } from "../../open-sse/services/model.js";

describe("port 9router #1694: Bedrock short alias", () => {
  it("resolves br and bedrock prefixes to the bedrock provider", () => {
    expect(resolveProviderAlias("br")).toBe("bedrock");
    expect(resolveProviderAlias("bedrock")).toBe("bedrock");
  });

  it("parses br/<model> as a bedrock model", () => {
    const parsed = parseModel("br/us.amazon.nova-micro-v1:0");
    expect(parsed.provider).toBe("bedrock");
    expect(parsed.model).toBe("us.amazon.nova-micro-v1:0");
  });
});
