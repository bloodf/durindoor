import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import {
  openaiToAntigravityRequest,
  openaiToGeminiCLIRequest,
  openaiToGeminiRequest,
} from "../../open-sse/translator/request/openai-to-gemini.js";
import { openaiToVertexRequest } from "../../open-sse/translator/request/openai-to-vertex.js";

const credentials = { projectId: "project-1", connectionId: "connection-1" };
const messages = [
  { role: "system", content: "OpenCode, opencode, OPENCODE. Keep this." },
  { role: "user", content: "Do not rewrite OpenCode here." },
  {
    role: "assistant",
    content: "OpenCode remains in assistant content.",
    tool_calls: [{
      id: "call_1",
      type: "function",
      function: { name: "lookup", arguments: "{}" },
    }],
  },
  { role: "tool", tool_call_id: "call_1", content: "OpenCode remains in tool content." },
  { role: "user", content: "Continue." },
];

const transformAntigravity = (model, requestMessages) => new AntigravityExecutor().transformRequest(
  model,
  openaiToAntigravityRequest(model, { messages: requestMessages }, false, credentials),
  false,
  credentials,
);

function expectConversationUnchanged(request) {
  expect(request.contents[0].parts).toEqual([{ text: "Do not rewrite OpenCode here." }]);
  expect(request.contents.find(({ role }) => role === "model").parts).toContainEqual(
    { text: "OpenCode remains in assistant content." },
  );
  const toolResponse = request.contents.flatMap(({ parts }) => parts).find((part) => part.functionResponse);
  expect(JSON.stringify(toolResponse.functionResponse.response)).toContain("OpenCode remains in tool content.");
}

/** Regression coverage for corrected decolua/9router#3454 Antigravity-only scope. */
describe("Antigravity system prompt sanitization", () => {
  it("sanitizes Gemini-backed Antigravity system prompts after translation", () => {
    const result = transformAntigravity("gemini-test", messages);

    expect(result.request.systemInstruction.parts).toEqual([
      { text: "Antigravity, antigravity, ANTIGRAVITY. Keep this." },
    ]);
    expectConversationUnchanged(result.request);
  });

  it("sanitizes Claude-backed Antigravity system prompts after translation", () => {
    const result = transformAntigravity("claude-opus-test", messages);

    expect(result.request.systemInstruction.parts).toEqual([
      { text: "Antigravity, antigravity, ANTIGRAVITY. Keep this." },
    ]);
    expectConversationUnchanged(result.request);
  });

  it.each(["gemini-test", "claude-opus-test"])(
    "sanitizes a system-only %s Antigravity request",
    (model) => {
      const result = transformAntigravity(model, [{ role: "system", content: "OpenCode only" }]);

      expect(result.request.systemInstruction.parts).toEqual([{ text: "Antigravity only" }]);
    },
  );

  it("leaves plain Gemini, Gemini CLI, and Vertex system prompts unchanged", () => {
    const body = { messages: [{ role: "system", content: "OpenCode only" }, { role: "user", content: "Go" }] };

    expect(openaiToGeminiRequest("gemini-test", body, false).systemInstruction.parts)
      .toEqual([{ text: "OpenCode only" }]);
    expect(openaiToGeminiCLIRequest("gemini-test", body, false).systemInstruction.parts)
      .toEqual([{ text: "OpenCode only" }]);
    expect(openaiToVertexRequest("gemini-test", body, false, credentials).systemInstruction.parts)
      .toEqual([{ text: "OpenCode only" }]);

    const systemOnlyBody = { messages: [{ role: "system", content: "OpenCode only" }] };
    expect(openaiToGeminiRequest("gemini-test", systemOnlyBody, false).contents[0].parts)
      .toEqual([{ text: "OpenCode only" }]);
    expect(openaiToGeminiCLIRequest("gemini-test", systemOnlyBody, false).contents[0].parts)
      .toEqual([{ text: "OpenCode only" }]);
    expect(openaiToVertexRequest("gemini-test", systemOnlyBody, false, credentials).contents[0].parts)
      .toEqual([{ text: "OpenCode only" }]);
  });
});
