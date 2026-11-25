import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const toolResponse = (target, content, source = FORMATS.OPENAI) => {
  const messages = source === FORMATS.CLAUDE
    ? [
      { role: "assistant", content: [{ type: "tool_use", id: "call_git_1", name: "git", input: { args: "status" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_git_1", content }] },
    ]
    : [
      { role: "assistant", tool_calls: [{ id: "call_git_1", type: "function", function: { name: "git", arguments: '{"args":"status"}' } }] },
      { role: "tool", tool_call_id: "call_git_1", content },
    ];
  const model = source === FORMATS.CLAUDE ? "claude-sonnet-5-5-high" : "gemini-4-argon-high";
  const out = translateRequest(source, target, model, { messages }, true, null, target === FORMATS.ANTIGRAVITY ? "antigravity" : "gemini");
  return (out.request?.contents || out.contents)
    .flatMap((turn) => turn.parts || [])
    .find((part) => part.functionResponse).functionResponse;
};

describe("upstream 9router #5529: Gemini functionResponse wraps a tool result once", () => {
  it.each([FORMATS.GEMINI, FORMATS.ANTIGRAVITY])("%s keeps plain text under one result key", (target) => {
    expect(toolResponse(target, "On branch main")).toMatchObject({
      id: "call_git_1",
      name: "git",
      response: { result: "On branch main" },
    });
    expect(toolResponse(target, "On branch main").response).toEqual({ result: "On branch main" });
  });

  it.each([
    ["5", { result: 5 }],
    ['{"branch":"main"}', { result: { branch: "main" } }],
    ['["a","b"]', { result: ["a", "b"] }],
    ['{"result":"clean","code":0}', { result: "clean", code: 0 }],
  ])("wraps %s exactly once", (content, expected) => {
    expect(toolResponse(FORMATS.GEMINI, content).response).toEqual(expected);
  });

  it("does not rewrap a result envelope on the Antigravity Claude lane", () => {
    expect(toolResponse(FORMATS.ANTIGRAVITY, '{"result":"clean"}', FORMATS.CLAUDE).response).toEqual({ result: "clean" });
  });
});
