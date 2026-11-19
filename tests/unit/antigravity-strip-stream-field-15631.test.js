import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

describe("Antigravity stream envelope", () => {
  it("strips the top-level stream field before sending the Cloud Code envelope", () => {
    const body = {
      stream: true,
      request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    };

    const transformed = new AntigravityExecutor().transformRequest(
      "gemini-3.8-flash",
      body,
      true,
      { projectId: "project-1" },
    );

    expect(transformed.stream).toBeUndefined();
  });
});
