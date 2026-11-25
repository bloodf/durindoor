import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { translateOpenAIToClaudeIfNeeded } from "../../open-sse/translator/response/openai-to-claude-json.js";
import { projectCompletionToClientFormat } from "../../open-sse/translator/response/completionProjector.js";

const completion = (usage, id = "chatcmpl-abc") => ({
  id,
  object: "chat.completion",
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
  usage,
});

// OpenAI prompt_tokens includes cache reads and writes; Claude input_tokens does not.
const cachedUsage = {
  prompt_tokens: 10_000,
  completion_tokens: 250,
  prompt_tokens_details: { cached_tokens: 8_000, cache_creation_tokens: 500 },
};
const claudeUsage = { input_tokens: 1_500, output_tokens: 250, cache_read_input_tokens: 8_000, cache_creation_input_tokens: 500 };

const projections = {
  "JSON upstream": (body) => translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.CLAUDE),
  "Gemini pivot": (body) => translateOpenAIToClaudeIfNeeded(body, FORMATS.CLAUDE),
  "forced SSE": (body) => projectCompletionToClientFormat(body, FORMATS.CLAUDE),
};

describe("port(upstream) #5250: non-streaming Claude messages", () => {
  it.each(Object.entries(projections))("counts cached prompt tokens once (%s)", (_name, project) => {
    expect(project(completion(cachedUsage)).usage).toEqual(claudeUsage);
  });

  it.each(Object.entries(projections))("never reports negative input tokens (%s)", (_name, project) => {
    const usage = { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 40 } };
    expect(project(completion(usage)).usage.input_tokens).toBe(0);
  });

  it.each(Object.entries(projections))("keeps one msg_ id prefix (%s)", (_name, project) => {
    expect(project(completion(cachedUsage, "msg_abc")).id).toBe("msg_abc");
    expect(project(completion(cachedUsage)).id).toBe("msg_abc");
  });

  it("returns a Claude message for a Gemini upstream with cached content", () => {
    const pivot = translateNonStreamingResponse({
      response: {
        responseId: "r1",
        candidates: [{ content: { parts: [{ text: "summary" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10_000, cachedContentTokenCount: 8_000, candidatesTokenCount: 250, totalTokenCount: 10_250 },
      },
    }, FORMATS.ANTIGRAVITY, FORMATS.CLAUDE);
    expect(translateOpenAIToClaudeIfNeeded(pivot, FORMATS.CLAUDE)).toMatchObject({
      type: "message",
      usage: { input_tokens: 2_000, output_tokens: 250, cache_read_input_tokens: 8_000 },
    });
  });
});
