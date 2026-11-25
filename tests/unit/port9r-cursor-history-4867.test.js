import { describe, expect, it } from "vitest";
import { buildAgentRunFrame, CursorExecutor, tailOnlyCursorMessages } from "../../open-sse/executors/cursor.js";
import { decodeMessage } from "../../open-sse/utils/cursorProtobuf.js";
import { openaiToCursorRequest } from "../../open-sse/translator/request/openai-to-cursor.js";

function readUserAction(messages) {
  const frame = buildAgentRunFrame(messages, "gpt-5.2");
  const run = decodeMessage(decodeMessage(frame.subarray(5)).get(1)[0].value);
  const action = decodeMessage(run.get(2)[0].value);
  return decodeMessage(action.get(1)[0].value);
}

function readUserText(messages) {
  const user = decodeMessage(readUserAction(messages).get(1)[0].value);
  return Buffer.from(user.get(1)[0].value).toString("utf8");
}

const toolCall = {
  id: "weather_1",
  type: "function",
  function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
};

describe("port(upstream) #4867: Cursor AgentService conversation history", () => {
  it("puts earlier user and assistant turns in the supported user text field", () => {
    const text = readUserText([
      { role: "user", content: "The secret word is pineapple." },
      { role: "assistant", content: "Remembered." },
      { role: "user", content: "What is the secret word?" },
    ]);
    expect(text).toContain("pineapple");
    expect(text).toContain("Remembered.");
    expect(text.indexOf("pineapple")).toBeLessThan(text.indexOf("Remembered."));
    expect(text.indexOf("Remembered.")).toBeLessThan(text.indexOf("What is the secret word?"));
    expect(text.endsWith("What is the secret word?")).toBe(true);
  });

  it("does not encode history in an undefined UserMessageAction field", () => {
    const action = readUserAction([
      { role: "user", content: "First turn" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Follow-up" },
    ]);
    expect([...action.keys()]).toEqual([1]);
  });

  it("keeps single-turn text unchanged without a history block", () => {
    expect(readUserText([{ role: "user", content: "Hello" }])).toBe("Hello");
  });

  it("preserves text parts and Unicode in prior turns", () => {
    const text = readUserText([
      { role: "user", content: [{ type: "text", text: "東京" }, { type: "text", text: "☀️" }] },
      { role: "user", content: "Remember both parts" },
    ]);
    expect(text).toContain("東京\n☀️");
  });

  it("preserves tool calls and every result after the latest user turn", () => {
    const text = readUserText([
      { role: "user", content: "Compare Tokyo weather" },
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", tool_call_id: "weather_1", content: "18C cloudy" },
      { role: "tool", tool_call_id: "weather_2", content: "22C sunny" },
    ]);
    for (const value of ["Compare Tokyo weather", "get_weather", '{"city":"Tokyo"}', "weather_1", "weather_2", "18C cloudy", "22C sunny"]) {
      expect(text).toContain(value);
    }
    expect(text.indexOf("18C cloudy")).toBeLessThan(text.indexOf("22C sunny"));
  });

  it("preserves a final assistant tool call when no new user turn exists", () => {
    const text = readUserText([
      { role: "user", content: "Check the weather" },
      { role: "assistant", content: null, tool_calls: [toolCall] },
    ]);
    expect(text).toContain("Check the weather");
    expect(text).toContain("get_weather");
    expect(text).toContain("weather_1");
  });

  it("keeps a trailing assistant text turn labelled as assistant content", () => {
    const text = readUserText([
      { role: "user", content: "Write a report" },
      { role: "assistant", content: "The report begins" },
    ]);
    expect(text).toContain("Write a report");
    expect(text.endsWith("[assistant]\nThe report begins")).toBe(true);
  });

  it("puts system and developer instructions before conversation history", () => {
    const text = readUserText([
      { role: "system", content: "Keep answers short" },
      { role: "developer", content: "Use metric units" },
      { role: "user", content: "Original task" },
      { role: "assistant", content: "Working" },
      { role: "user", content: "Continue the task" },
    ]);
    expect(text.startsWith("Keep answers short\n\nUse metric units\n\n")).toBe(true);
    expect(text.indexOf("Use metric units")).toBeLessThan(text.indexOf("Original task"));
    expect(text.match(/Keep answers short/g)).toHaveLength(1);
    expect(text.match(/Use metric units/g)).toHaveLength(1);
  });

  it("carries instructions and tool history through the actual request translator", () => {
    const translated = openaiToCursorRequest("gpt-5.2", { messages: [
      { role: "system", content: "Return a weather report" },
      { role: "developer", content: "Use metric units" },
      { role: "user", content: "Tokyo forecast" },
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", tool_call_id: "weather_1", content: "18C cloudy" },
    ] });
    expect(translated.messages.slice(0, 2).map(message => message.role)).toEqual(["system", "system"]);
    const text = readUserText(translated.messages);
    expect(text.startsWith("Return a weather report\n\nUse metric units\n\n")).toBe(true);
    for (const value of ["Tokyo forecast", "get_weather", "weather_1", "18C cloudy"]) expect(text).toContain(value);
  });

  it("retains legacy ChatService system instruction encoding", () => {
    const body = openaiToCursorRequest("gpt-5.2", { messages: [
      { role: "system", content: "Keep answers short" },
      { role: "developer", content: "Use metric units" },
      { role: "user", content: "Hello" },
    ] });
    const frame = new CursorExecutor().transformRequest("gpt-5.2", body, false, {});
    const request = decodeMessage(decodeMessage(frame.subarray(5)).get(1)[0].value);
    const messages = request.get(1).map(field => decodeMessage(field.value));
    expect(Buffer.from(messages[0].get(1)[0].value).toString()).toBe("[System Instructions]\nKeep answers short");
    expect(Number(messages[0].get(2)[0].value)).toBe(1);
    expect(Buffer.from(messages[1].get(1)[0].value).toString()).toBe("[System Instructions]\nUse metric units");
    expect(Number(messages[1].get(2)[0].value)).toBe(1);
  });

  it("keeps developer instructions in a tail-only retry", () => {
    const trimmed = tailOnlyCursorMessages([
      { role: "developer", content: "Use metric units" },
      { role: "user", content: "old" },
      { role: "assistant", content: "older answer" },
      { role: "user", content: "now" },
    ]);
    expect(trimmed[0]).toEqual({ role: "developer", content: "Use metric units" });
    expect(readUserText(trimmed).startsWith("Use metric units\n\n")).toBe(true);
  });

  it("does not mutate the original messages", () => {
    const messages = [{ role: "user", content: "Task" }, { role: "assistant", content: null, tool_calls: [toolCall] }];
    const original = structuredClone(messages);
    readUserText(messages);
    expect(messages).toEqual(original);
  });

  it("uses the existing continuation prompt for empty input", () => {
    expect(readUserText([])).toBe("Continue.");
  });
});
