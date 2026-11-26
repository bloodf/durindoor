import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const tool = { type: "function", name: "run", parameters: { type: "object", properties: {} } };
const userMessage = { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] };

describe("upstream 9router #2796: Codex executor normalizes additional_tools items", () => {
  it.each([[null], [[]], ["stray"]])("drops content %j without mutating the caller's item", (content) => {
    const envelope = { type: "additional_tools", role: "developer", content, tools: [tool] };

    const body = new CodexExecutor().transformRequest("gpt-6-luna", {
      model: "gpt-6-luna",
      input: [envelope, userMessage],
    }, true, {});

    expect(body.input).toHaveLength(2);
    expect(body.input[0]).not.toHaveProperty("content");
    expect(body.input[0]).toMatchObject({ type: "additional_tools", role: "developer", tools: [{ name: "run" }] });
    expect(body.input[1].content).toEqual(userMessage.content);
    expect(envelope.content).toEqual(content);
  });
});
