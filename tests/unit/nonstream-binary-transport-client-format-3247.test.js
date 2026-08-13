import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/translator/response/completionProjector.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    projectCompletionToClientFormat: vi.fn(actual.projectCompletionToClientFormat),
  };
});

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { projectCompletionToClientFormat } = await import("../../open-sse/translator/response/completionProjector.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

describe("#3247 non-streaming binary-transport replies", () => {
  it("projects a decoded Kiro completion into the Claude client format", () => {
    const response = {
      id: "chatcmpl-kiro",
      object: "chat.completion",
      model: "claude-haiku-4.5",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Hey there." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    };

    const projected = translateNonStreamingResponse(response, FORMATS.KIRO, FORMATS.CLAUDE);

    expect(projected).toMatchObject({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hey there." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 8 },
    });
    expect(projected.choices).toBeUndefined();
  });

  it("projects a decoded Cursor completion into the Claude client format", () => {
    const response = {
      id: "chatcmpl-cursor",
      object: "chat.completion",
      model: "cursor-small",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Decoded from Cursor." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 },
    };

    const projected = translateNonStreamingResponse(response, FORMATS.CURSOR, FORMATS.CLAUDE);

    expect(projected).toMatchObject({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Decoded from Cursor." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 6, output_tokens: 4 },
    });
    expect(projected.choices).toBeUndefined();
  });

  it("projects a decoded Cursor completion into the OpenAI client format", () => {
    const response = {
      id: "chatcmpl-cursor-openai",
      object: "chat.completion",
      model: "cursor-small",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "OpenAI client reply." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };
    projectCompletionToClientFormat.mockClear();

    const projected = translateNonStreamingResponse(response, FORMATS.CURSOR, FORMATS.OPENAI);

    expect(projected).toMatchObject({
      object: "chat.completion",
      model: "cursor-small",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "OpenAI client reply." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });
    expect(projectCompletionToClientFormat).toHaveBeenCalledOnce();
    expect(projectCompletionToClientFormat).toHaveBeenCalledWith(response, FORMATS.OPENAI, {});
    expect(projected.content).toBeUndefined();
  });

  it("passes an existing OpenAI choices array through unchanged", () => {
    const response = {
      id: "chatcmpl-existing",
      object: "chat.completion",
      model: "cursor-small",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Already formatted." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    };
    const before = structuredClone(response);
    projectCompletionToClientFormat.mockClear();

    const projected = translateNonStreamingResponse(response, FORMATS.CURSOR, FORMATS.OPENAI);

    expect(projected).toBe(response);
    expect(projected).toEqual(before);
    expect(projectCompletionToClientFormat).toHaveBeenCalledOnce();
  });
});
