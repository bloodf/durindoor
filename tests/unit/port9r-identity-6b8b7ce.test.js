import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { ANTIGRAVITY_IDE_USER_AGENT } from "../../open-sse/providers/shared.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const require = createRequire(import.meta.url);
const { ANTIGRAVITY_IDE_VERSION, rewriteAntigravityUserAgent } = require("../../src/mitm/antigravityIdeVersion.js");

describe("Antigravity IDE identity", () => {
  it("preserves hub and bare user agent shapes and shares the version", () => {
    expect(rewriteAntigravityUserAgent("antigravity/hub/1.0 darwin/arm64", ANTIGRAVITY_IDE_VERSION)).toBe(ANTIGRAVITY_IDE_USER_AGENT);
    expect(rewriteAntigravityUserAgent("antigravity/1.0 linux/x64", ANTIGRAVITY_IDE_VERSION)).toBe(`antigravity/${ANTIGRAVITY_IDE_VERSION} linux/x64`);
    expect(rewriteAntigravityUserAgent("other/1.0", ANTIGRAVITY_IDE_VERSION)).toBe("other/1.0");
  });
  it("requests event streams only when streaming", () => {
    const executor = new AntigravityExecutor();
    expect(executor.buildHeaders({ accessToken: "test" }, true).Accept).toBe("text/event-stream");
    expect(executor.buildHeaders({ accessToken: "test" }, false).Accept).toBeUndefined();
  });
});
