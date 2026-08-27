import { describe, expect, it } from "vitest";
import {
  openaiToAntigravityRequest,
  openaiToGeminiRequest,
} from "../../open-sse/translator/request/openai-to-gemini.js";

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

/** Regression coverage for decolua/9router#3454 system-prompt sanitization. */
describe("Gemini/Antigravity system prompt sanitization", () => {
  it("sanitizes OpenCode casing in Gemini system prompts only", () => {
    const result = openaiToGeminiRequest("gemini-test", { messages }, false);

    expect(result.systemInstruction.parts).toEqual([
      { text: "Antigravity, antigravity, ANTIGRAVITY. Keep this." },
    ]);
    expect(result.contents[0].parts).toEqual([
      { text: "Do not rewrite OpenCode here." },
    ]);
    expect(result.contents.find(({ role }) => role === "model").parts).toContainEqual(
      { text: "OpenCode remains in assistant content." },
    );
    const toolResponse = result.contents.flatMap(({ parts }) => parts).find((part) => part.functionResponse);
    expect(JSON.stringify(toolResponse.functionResponse.response)).toContain("OpenCode remains in tool content.");
  });

  it("sanitizes a system-only Gemini request", () => {
    const result = openaiToGeminiRequest("gemini-test", {
      messages: [{ role: "system", content: "OpenCode only" }],
    }, false);

    expect(result.contents[0].parts).toEqual([{ text: "Antigravity only" }]);
  });

  it("sanitizes OpenCode casing in Claude-backed Antigravity system prompts only", () => {
    const result = openaiToAntigravityRequest(
      "claude-opus-test",
      { messages },
      false,
      { projectId: "project-1", connectionId: "connection-1" },
    );

    expect(result.request.systemInstruction.parts).toEqual([
      { text: "Antigravity, antigravity, ANTIGRAVITY. Keep this." },
    ]);
    expect(result.request.contents[0].parts).toEqual([
      { text: "Do not rewrite OpenCode here." },
    ]);
    expect(result.request.contents.find(({ role }) => role === "model").parts).toContainEqual(
      { text: "OpenCode remains in assistant content." },
    );
    const toolResponse = result.request.contents.flatMap(({ parts }) => parts).find((part) => part.functionResponse);
    expect(JSON.stringify(toolResponse.functionResponse.response)).toContain("OpenCode remains in tool content.");
  });
});
