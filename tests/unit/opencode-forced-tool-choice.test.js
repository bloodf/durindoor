import { describe, expect, it } from "vitest";
import { normalizeResponsesTools } from "../../open-sse/executors/opencode-go.js";

describe("OpenCode Responses forced tool choice", () => {
  it("flattens a Chat-shaped choice and retains a declared tool", () => {
    const body = { tools: [{ type: "function", name: "lookup" }], tool_choice: { type: "function", function: { name: " lookup " } } };
    normalizeResponsesTools(body);
    expect(body.tool_choice).toEqual({ type: "function", name: "lookup" });
  });

  it("drops a forced choice that does not name a declared tool", () => {
    const body = { tools: [{ type: "function", name: "lookup" }], tool_choice: { type: "function", function: { name: "missing" } } };
    normalizeResponsesTools(body);
    expect(body.tool_choice).toBeUndefined();
  });
});
