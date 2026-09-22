import { describe, expect, it } from "vitest";

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// Port of upstream 9router #4229. The official Antigravity client omits
// `requestType` entirely on the agent (chat) path; sending `requestType:
// "agent"` makes Google bucket the request and return a detail-free 429
// RESOURCE_EXHAUSTED even with quota available.
describe("Antigravity agent requests omit requestType (port #4229)", () => {
  it("does not set requestType on the Gemini agent envelope", () => {
    const body = openaiToAntigravityRequest("gemini-3.8-flash-tiered", {
      messages: [{ role: "user", content: "hi" }],
    }, true);
    expect(body).not.toHaveProperty("requestType");
  });

  it("does not set requestType on the Claude agent envelope", () => {
    const body = openaiToAntigravityRequest("claude-sonnet-4-5", {
      messages: [{ role: "user", content: "hi" }],
    }, true);
    expect(body).not.toHaveProperty("requestType");
  });

  it("strips requestType from the executor's transformed request even if present on the input", () => {
    const body = openaiToAntigravityRequest("gemini-3.8-flash-tiered", {
      messages: [{ role: "user", content: "hi" }],
    }, true);
    body.requestType = "agent"; // simulate a leaked/legacy value from an upstream envelope
    const finalBody = new AntigravityExecutor().transformRequest("gemini-3.8-flash-tiered", body, true, {});
    expect(finalBody).not.toHaveProperty("requestType");
  });
});
