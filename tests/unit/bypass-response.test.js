import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSyntheticResponse } from "../../open-sse/utils/bypassResponse.js";

async function jsonResponse(sourceFormat) {
  const { response } = createSyntheticResponse({
    sourceFormat,
    model: "demo-model",
    text: "hello world",
    stream: false,
  });
  return { response, body: await response.json() };
}

async function streamResponse(sourceFormat) {
  const { response } = createSyntheticResponse({
    sourceFormat,
    model: "demo-model",
    text: "hello world",
    stream: true,
  });
  return { response, text: await response.text() };
}

function dataPayloads(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
}

describe("createSyntheticResponse JSON", () => {
  it("projects OpenAI Chat Completions", async () => {
    const { response, body } = await jsonResponse(FORMATS.OPENAI);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(body).toMatchObject({
      object: "chat.completion",
      model: "demo-model",
      choices: [{ message: { content: "hello world" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });

  it("projects a native Responses object with model and usage", async () => {
    const { body } = await jsonResponse(FORMATS.OPENAI_RESPONSES);
    expect(body).toMatchObject({
      object: "response",
      model: "demo-model",
      status: "completed",
      output: [{ content: [{ type: "output_text", text: "hello world" }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    expect(body.choices).toBeUndefined();
  });

  it("projects a complete Claude message", async () => {
    const { body } = await jsonResponse(FORMATS.CLAUDE);
    expect(body).toMatchObject({
      type: "message",
      model: "demo-model",
      content: [{ type: "text", text: "hello world" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });

  it.each([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.ANTIGRAVITY, FORMATS.VERTEX])("projects a complete %s response", async (format) => {
    const { body } = await jsonResponse(format);
    expect(body.response).toMatchObject({
      candidates: [{
        content: { role: "model", parts: [{ text: "hello world" }] },
        finishReason: "STOP",
      }],
      modelVersion: "demo-model",
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    });
  });
});

describe("createSyntheticResponse SSE", () => {
  it("uses Chat Completions frames and [DONE] only for OpenAI", async () => {
    const { response, text } = await streamResponse(FORMATS.OPENAI);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(text).toContain('"content":"hello world"');
    expect(text).toContain("data: [DONE]\n\n");
    expect(text).not.toContain("data: null");
  });

  it("uses native named Responses events with model and usage", async () => {
    const { text } = await streamResponse(FORMATS.OPENAI_RESPONSES);
    expect(text).toContain("event: response.created");
    expect(text).toContain("event: response.output_text.delta");
    expect(text).toContain("event: response.completed");
    expect(text).toContain('"model":"demo-model"');
    expect(text).toContain('"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2');
    expect(text).not.toContain('"choices"');
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain("data: null");
  });

  it("uses Claude events ending at message_stop", async () => {
    const { text } = await streamResponse(FORMATS.CLAUDE);
    expect(text).toContain("event: message_start");
    expect(text).toContain('"type":"text_delta","text":"hello world"');
    expect(text).toContain("event: message_stop");
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain("data: null");
  });

  it.each([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.ANTIGRAVITY, FORMATS.VERTEX])("uses native %s frames ending at finishReason", async (format) => {
    const { text } = await streamResponse(format);
    const payloads = dataPayloads(text);
    expect(payloads.some((item) => item.response?.candidates?.[0]?.content?.parts?.[0]?.text === "hello world")).toBe(true);
    expect(payloads.some((item) => item.response?.candidates?.[0]?.finishReason === "STOP")).toBe(true);
    expect(payloads.some((item) => item.response?.modelVersion === "demo-model")).toBe(true);
    expect(payloads.some((item) => item.response?.usageMetadata?.totalTokenCount === 2)).toBe(true);
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain("data: null");
  });
});
