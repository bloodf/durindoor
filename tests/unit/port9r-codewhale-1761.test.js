import { describe, expect, it } from "vitest";
import { detectClientTool } from "../../open-sse/utils/clientDetector.js";

describe("CodeWhale client detection", () => {
  it("recognizes current and legacy user agents for the same streaming behavior", () => {
    expect(detectClientTool({ "user-agent": "CodeWhale/1.0" })).toBe("deepseek-tui");
    expect(detectClientTool({ "user-agent": "deepseek-tui/1.0" })).toBe("deepseek-tui");
  });
});
