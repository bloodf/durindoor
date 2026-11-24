// Ported from OmniRoute #20224 (upstream commits 2d0d3112ad0f050e85bbba8c7f61ec4a3e67dec9
// and the usage part of 73f02b9d74324a6e2c7ebc03388e592d58233536): Gemini usageMetadata
// reads Responses usage names and counts reasoning once, streaming and non-streaming.
//
// Synthetic fixtures only: no provider call, no credentials, no network.

import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { OPENAI_FINISH, ROLE } from "../../open-sse/translator/schema/index.js";
import { projectCompletionToClientFormat } from "../../open-sse/translator/response/completionProjector.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import {
  convertOpenAIResponseToGemini,
  transformOpenAISSEToGeminiSSE
} from "../../src/app/api/v1beta/models/[...path]/geminiBridge.js";

const RESPONSES_USAGE = {
  input_tokens: 10,
  output_tokens: 30,
  total_tokens: 40,
  input_tokens_details: { cached_tokens: 4 },
  output_tokens_details: { reasoning_tokens: 20 }
};
const CHAT_USAGE = {
  prompt_tokens: 10,
  completion_tokens: 30,
  total_tokens: 40,
  prompt_tokens_details: { cached_tokens: 4 },
  completion_tokens_details: { reasoning_tokens: 20 }
};
const EXPECTED = {
  promptTokenCount: 10,
  candidatesTokenCount: 10,
  totalTokenCount: 40,
  thoughtsTokenCount: 20,
  cachedContentTokenCount: 4
};

const finishChunk = (usage) => ({
  id: "chatcmpl-ru",
  object: "chat.completion.chunk",
  model: "m",
  choices: [{ index: 0, delta: { content: "hi" }, finish_reason: OPENAI_FINISH.STOP }],
  usage
});
const completion = (usage) => ({
  id: "chatcmpl-ru",
  object: "chat.completion",
  model: "m",
  choices: [{ index: 0, message: { role: ROLE.ASSISTANT, content: "hi" }, finish_reason: OPENAI_FINISH.STOP }],
  usage
});

const streamUsage = (format, usage) =>
  translateResponse(FORMATS.OPENAI, format, finishChunk(usage), initState(format))
    .find((frame) => frame.response?.usageMetadata).response.usageMetadata;
const nonStreamUsage = (usage) =>
  projectCompletionToClientFormat(completion(usage), FORMATS.ANTIGRAVITY).response.usageMetadata;
const nativeUsage = (usage) =>
  translateNonStreamingResponse(completion(usage), FORMATS.OPENAI, FORMATS.GEMINI).usageMetadata;
const bridgeJsonUsage = async (usage) =>
  (await (await convertOpenAIResponseToGemini(Response.json(completion(usage)), "m")).json()).usageMetadata;
const bridgeStreamUsage = async (usage) => {
  const upstream = new Response(`data: ${JSON.stringify(finishChunk(usage))}\n\n`);
  const text = await transformOpenAISSEToGeminiSSE(upstream, "m").text();
  return JSON.parse(text.slice("data: ".length)).usageMetadata;
};

describe.each([
  ["Responses", RESPONSES_USAGE],
  ["Chat", CHAT_USAGE]
])("Gemini usageMetadata from %s usage names", (_name, usage) => {
  it.each([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY])("stream %s", (format) => {
    expect(streamUsage(format, usage)).toEqual(EXPECTED);
  });
  it("non-stream projector", () => expect(nonStreamUsage(usage)).toEqual(EXPECTED));
  it("non-stream native Gemini", () => expect(nativeUsage(usage)).toEqual(EXPECTED));
  it("/v1beta bridge JSON", async () => expect(await bridgeJsonUsage(usage)).toEqual(EXPECTED));
  it("/v1beta bridge stream", async () => expect(await bridgeStreamUsage(usage)).toEqual(EXPECTED));
});

describe("Gemini usageMetadata totals and edge counts", () => {
  const noTotal = { input_tokens: 10, output_tokens: 30 };

  it("derives the total for Responses names without total_tokens", () => {
    const expected = { promptTokenCount: 10, candidatesTokenCount: 30, totalTokenCount: 40 };
    expect(streamUsage(FORMATS.GEMINI, noTotal)).toEqual(expected);
    expect(nonStreamUsage(noTotal)).toEqual(expected);
  });

  it("does not subtract reasoning the upstream counted on top of the output", () => {
    const additive = { ...CHAT_USAGE, total_tokens: 60 };
    expect(streamUsage(FORMATS.GEMINI, additive)).toMatchObject({ candidatesTokenCount: 30, thoughtsTokenCount: 20 });
  });

  it("never reports negative candidates", () => {
    const usage = { input_tokens: 1, output_tokens: 5, output_tokens_details: { reasoning_tokens: 9 } };
    expect(nonStreamUsage(usage).candidatesTokenCount).toBe(0);
  });

  it("keeps a reported zero on native Gemini JSON", () => {
    const usage = { ...CHAT_USAGE, completion_tokens_details: { reasoning_tokens: 0 } };
    expect(nativeUsage(usage).thoughtsTokenCount).toBe(0);
  });
});
