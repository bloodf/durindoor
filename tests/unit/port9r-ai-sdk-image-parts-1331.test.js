import { describe, expect, it } from "vitest";
import { convertOpenAIContentToParts } from "../../open-sse/translator/formats/gemini.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOllamaRequest } from "../../open-sse/translator/request/openai-to-ollama.js";
import { openaiToCommandCodeRequest } from "../../open-sse/translator/request/openai-to-commandcode.js";

const FAKE_BASE64 = "iVBORw0KGgo=";
const DATA_URL = `data:image/png;base64,${FAKE_BASE64}`;

describe("port9r #1331: AI SDK image content parts across multimodal translators", () => {
  it("converts AI SDK image part to Gemini inlineData in openaiToGeminiRequest", () => {
    const result = openaiToGeminiRequest("gemini-2.5-pro", {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            { type: "image", image: DATA_URL },
          ],
        },
      ],
    }, true);

    expect(result.contents[0].parts).toEqual([
      { text: "Describe this image" },
      { inlineData: { mimeType: "image/png", data: FAKE_BASE64 } },
    ]);
  });

  it("preserves existing image_url data URI handling in convertOpenAIContentToParts", () => {
    const parts = convertOpenAIContentToParts([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,abc123" } },
      { type: "image", image: DATA_URL },
    ]);

    expect(parts).toEqual([
      { inlineData: { mimeType: "image/jpeg", data: "abc123" } },
      { inlineData: { mimeType: "image/png", data: FAKE_BASE64 } },
    ]);
  });

  it("converts AI SDK image part to Claude base64 image block in openaiToClaudeRequest", () => {
    const result = openaiToClaudeRequest("claude-sonnet-4.5", {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            { type: "image", image: DATA_URL },
          ],
        },
      ],
    }, false);

    expect(result.messages[0].content).toEqual([
      { type: "text", text: "Describe this image" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: FAKE_BASE64 },
      },
    ]);
  });

  it("converts AI SDK image part inside tool result content for Claude", () => {
    const result = openaiToClaudeRequest("claude-sonnet-4.5", {
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "screenshot", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: [
            { type: "text", text: "Captured" },
            { type: "image", image: DATA_URL },
          ],
        },
      ],
    }, false);

    const toolResultMsg = result.messages.find((m) => m.role === "user");
    const toolResult = toolResultMsg.content.find((b) => b.type === "tool_result");
    expect(toolResult.content).toEqual([
      { type: "text", text: "Captured" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: FAKE_BASE64 },
      },
    ]);
  });

  it("forwards AI SDK base64 image part to Kiro images[] in openaiToKiroRequest", () => {
    const result = openaiToKiroRequest("claude-sonnet-4.6", {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            { type: "image", image: DATA_URL },
          ],
        },
      ],
    }, true, {});

    const currentMsg = result.conversationState.currentMessage;
    expect(currentMsg.userInputMessage.images).toEqual([
      { format: "png", source: { bytes: FAKE_BASE64 } },
    ]);
  });

  it("converts AI SDK image part to input_image in openaiToOpenAIResponsesRequest", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-5.2", {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            { type: "image", image: DATA_URL, detail: "high" },
          ],
        },
      ],
    }, true, {});

    expect(result.input[0].content).toEqual([
      { type: "input_text", text: "Describe this image" },
      { type: "input_image", image_url: DATA_URL, detail: "high" },
    ]);
  });

  it("extracts raw base64 from AI SDK image part in openaiToOllamaRequest", () => {
    const result = openaiToOllamaRequest("llava", {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            { type: "image", image: DATA_URL },
          ],
        },
      ],
    }, true);

    expect(result.messages[0]).toEqual({
      role: "user",
      content: "Describe this image",
      images: [FAKE_BASE64],
    });
  });

  it("converts AI SDK image part in tool result for openaiToGeminiRequest", () => {
    const result = openaiToGeminiRequest("gemini-2.5-pro", {
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call_img", type: "function", function: { name: "screenshot", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "call_img",
          content: [
            { type: "text", text: "Captured" },
            { type: "image", image: DATA_URL },
          ],
        },
      ],
    }, true);

    const toolTurn = result.contents.find((c) => c.role === "user");
    expect(toolTurn.parts).toContainEqual({
      inlineData: { mimeType: "image/png", data: FAKE_BASE64 },
    });
  });

  it("preserves AI SDK image part in tool output array for openaiToOpenAIResponsesRequest", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-5.2", {
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call_img", type: "function", function: { name: "screenshot", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "call_img",
          content: [
            { type: "text", text: "Captured" },
            { type: "image", image: DATA_URL },
          ],
        },
      ],
    }, true, {});

    const toolOutput = result.input.find((item) => item.type === "function_call_output");
    expect(toolOutput.output).toEqual([
      { type: "input_text", text: "Captured" },
      { type: "input_image", image_url: DATA_URL, detail: "auto" },
    ]);
  });

  it("preserves DurinDoor native multimodal image forwarding in openaiToCommandCodeRequest", () => {
    const result = openaiToCommandCodeRequest("claude-sonnet-4.5", {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe" },
            { type: "image", image: DATA_URL },
          ],
        },
      ],
    }, true);

    expect(result.params.messages[0].content).toEqual([
      { type: "text", text: "Describe" },
      { type: "image", image: DATA_URL, mimeType: "image/png" },
    ]);
  });
});
