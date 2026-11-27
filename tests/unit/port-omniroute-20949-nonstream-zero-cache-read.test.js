import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { translateOpenAIToClaudeIfNeeded } from "../../open-sse/translator/response/openai-to-claude-json.js";
import { projectCompletionToClientFormat } from "../../open-sse/translator/response/completionProjector.js";
import { openAIResponsesBodyToClaude } from "../../open-sse/translator/response/openai-responses-nonstream.js";

const chatCompletion = (usage) => ({
  id: "chatcmpl-zero-cache",
  object: "chat.completion",
  model: "claude-test",
  choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
  usage,
});

const responsesBody = (usage) => ({
  id: "resp_zero_cache",
  object: "response",
  status: "completed",
  model: "claude-test",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] }],
  usage,
});

describe("OmniRoute #20949 (5f88e6720076 / 1e5bb90b38e9): non-streaming Claude responses retain explicit zero cache reads", () => {
  it.each([
    [
      "Responses inclusive detail explicit zero with cache write",
      { input_tokens: 50000, output_tokens: 7, input_tokens_details: { cached_tokens: 0, cache_creation_tokens: 1200 } },
      { input_tokens: 48800, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 1200 },
    ],
    [
      "Responses exclusive flat cache_read_input_tokens explicit zero",
      { input_tokens: 48800, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 1200 },
      { input_tokens: 48800, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 1200 },
    ],
    [
      "Responses flat cached_tokens explicit zero",
      { input_tokens: 50000, output_tokens: 7, cached_tokens: 0 },
      { input_tokens: 50000, output_tokens: 7, cache_read_input_tokens: 0 },
    ],
    [
      "Responses omitted cache read stays omitted",
      { input_tokens: 50000, output_tokens: 7 },
      { input_tokens: 50000, output_tokens: 7 },
    ],
    [
      "Responses invalid or string-zero cache read stays omitted",
      { input_tokens: 50000, output_tokens: 7, input_tokens_details: { cached_tokens: "0" }, cached_tokens: -1 },
      { input_tokens: 50000, output_tokens: 7 },
    ],
  ])("%s", (_label, usage, expectedUsage) => {
    expect(openAIResponsesBodyToClaude(responsesBody(usage)).usage).toEqual(expectedUsage);
    expect(translateNonStreamingResponse(responsesBody(usage), FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE).usage).toEqual(expectedUsage);
  });

  const chatProjections = [
    ["translateNonStreamingResponse", (body) => translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.CLAUDE)],
    ["translateOpenAIToClaudeIfNeeded", (body) => translateOpenAIToClaudeIfNeeded(body, FORMATS.CLAUDE)],
    ["projectCompletionToClientFormat", (body) => projectCompletionToClientFormat(body, FORMATS.CLAUDE)],
  ];

  it.each(chatProjections)("Chat -> Claude retains explicit zero and alias fallbacks via %s", (_name, project) => {
    for (const details of [
      { prompt_tokens_details: { cached_tokens: 0 } },
      { cached_tokens: 0 },
      { input_tokens_details: { cached_tokens: 0 } },
      { cache_read_input_tokens: 0 },
      { prompt_tokens_details: { cached_tokens: "0" }, input_tokens_details: { cached_tokens: 0 } },
    ]) {
      expect(project(chatCompletion({ prompt_tokens: 50000, completion_tokens: 7, ...details })).usage).toEqual({
        input_tokens: 50000,
        output_tokens: 7,
        cache_read_input_tokens: 0,
      });
    }

    expect(project(chatCompletion({ prompt_tokens: 50000, completion_tokens: 7, input_tokens_details: { cached_tokens: 43264 } })).usage).toEqual({
      input_tokens: 6736,
      output_tokens: 7,
      cache_read_input_tokens: 43264,
    });

    for (const omitted of [
      {},
      { prompt_tokens_details: {} },
      { prompt_tokens_details: { cached_tokens: "0" }, cached_tokens: -1, input_tokens_details: { cached_tokens: null }, cache_read_input_tokens: Infinity },
    ]) {
      expect(project(chatCompletion({ prompt_tokens: 50000, completion_tokens: 7, ...omitted })).usage).toEqual({
        input_tokens: 50000,
        output_tokens: 7,
      });
    }
  });
});
