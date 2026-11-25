// Ported from merged OmniRoute PR #18643 (head 5058c9f50545f71c303a063c031860e1ebb6544c,
// merge 20a7957590a10af180b5345d2e61405dfe8f666a): the OpenAI → Antigravity/Gemini
// stream translator must forward the trailing usage-only chunk (`choices: []`, sent
// after the finish chunk by `include_usage` upstreams) as `usageMetadata` instead of
// dropping it, without double-counting when usage already rode on the finish chunk.
//
// Local adaptation: this fork subtracts the reasoning share from
// `candidatesTokenCount` (OpenAI completion tokens include reasoning, Gemini counts
// thoughts separately), so the expected candidate count is 5 - 2 = 3, not upstream's 5.
// See internal/docs/v5-protocol-conformance.md.
//
// Synthetic fixtures only: no provider call, no credentials, no network.

import { describe, expect, it } from "vitest";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";
import "../translator/registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

const USAGE = {
  prompt_tokens: 11,
  completion_tokens: 5,
  total_tokens: 16,
  prompt_tokens_details: { cached_tokens: 4 },
  completion_tokens_details: { reasoning_tokens: 2 }
};

// prompt + candidates + thoughts === total holds with the local subtraction.
const EXPECTED_USAGE_METADATA = {
  promptTokenCount: 11,
  candidatesTokenCount: 3,
  totalTokenCount: 16,
  thoughtsTokenCount: 2,
  cachedContentTokenCount: 4
};

const TEXT_CHUNK = {
  id: "chatcmpl-su1",
  object: "chat.completion.chunk",
  model: "gpt-4.1",
  choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }]
};
const FINISH_CHUNK = {
  id: "chatcmpl-su1",
  object: "chat.completion.chunk",
  model: "gpt-4.1",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
};
const USAGE_ONLY_CHUNK = {
  id: "chatcmpl-su1",
  object: "chat.completion.chunk",
  model: "gpt-4.1",
  choices: [],
  usage: USAGE
};

const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

/** Parse the client-facing SSE bytes into JSON payloads. */
function parseFrames(text) {
  const payloads = [];
  for (const block of text.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice("data:".length).trim();
    if (data === "[DONE]") continue;
    payloads.push(JSON.parse(data));
  }
  return payloads;
}

/** Drive the production stream factory exactly like the chat handler does. */
async function runWire(clientFormat, events) {
  const encoder = new TextEncoder();
  const source = new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    }
  });
  const transform = createSSETransformStreamWithLogger(
    FORMATS.OPENAI,
    clientFormat,
    "openai",
    null,
    null,
    "gpt-4.1",
    null,
    { messages: [{ role: "user", content: "hi" }] },
    () => {}
  );
  return parseFrames(await new Response(source.pipeThrough(transform)).text());
}

describe("OpenAI → Antigravity translator: trailing usage-only chunk", () => {
  it("forwards a usage-only chunk after the finish chunk as usageMetadata", () => {
    const state = {};
    const finish = openaiToAntigravityResponse(
      { id: "chatcmpl-5", model: "gpt-4.1", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] },
      state
    );
    const trailing = openaiToAntigravityResponse(
      { id: "chatcmpl-5", model: "gpt-4.1", choices: [], usage: USAGE },
      state
    );

    expect(finish.response.usageMetadata).toBeUndefined();
    expect(trailing, "usage-only chunk after the finish chunk must reach the client").toBeTruthy();
    expect(trailing.response.usageMetadata).toEqual(EXPECTED_USAGE_METADATA);
    // The terminal candidate is not reopened and not repeated.
    expect(trailing.response.candidates[0].finishReason).toBeUndefined();
    expect(trailing.response.candidates[0].content.parts).toEqual([{ text: "" }]);
    expect(trailing.response.modelVersion).toBe("gpt-4.1");
    expect(trailing.response.responseId).toBe("chatcmpl-5");
  });

  it("does not repeat usage that already rode on the finish chunk", () => {
    const state = {};
    const finish = openaiToAntigravityResponse(
      { id: "chatcmpl-6", model: "gpt-4.1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: USAGE },
      state
    );
    const trailing = openaiToAntigravityResponse(
      { id: "chatcmpl-6", model: "gpt-4.1", choices: [], usage: USAGE },
      state
    );

    expect(finish.response.usageMetadata).toEqual(EXPECTED_USAGE_METADATA);
    expect(trailing).toBeNull();
  });

  it("keeps the pre-finish stash: usage seen before the finish chunk rides on it once", () => {
    const state = {};
    const stashed = openaiToAntigravityResponse(
      { id: "c7", model: "m", choices: [], usage: USAGE },
      state
    );
    const finish = openaiToAntigravityResponse(
      { id: "c7", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      state
    );
    const again = openaiToAntigravityResponse(
      { id: "c7", model: "m", choices: [], usage: USAGE },
      state
    );

    expect(stashed, "pre-finish usage chunk stays silent").toBeNull();
    expect(finish.response.usageMetadata).toEqual(EXPECTED_USAGE_METADATA);
    expect(again, "the stashed usage is not sent twice").toBeNull();
  });

  it("keeps a trailing chunk without usage dropped", () => {
    const state = {};
    openaiToAntigravityResponse(
      { id: "c8", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      state
    );
    expect(openaiToAntigravityResponse({ id: "c8", model: "m", choices: [] }, state)).toBeNull();
  });

  it("leaves a usage object without detail fields byte-identical to the pre-port projection", () => {
    const state = {};
    openaiToAntigravityResponse(
      { id: "c9", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      state
    );
    const trailing = openaiToAntigravityResponse(
      { id: "c9", model: "m", choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } },
      state
    );
    expect(trailing.response.usageMetadata).toEqual({
      promptTokenCount: 7,
      candidatesTokenCount: 3,
      totalTokenCount: 10
    });
  });
});

describe("OpenAI → Antigravity registered response path", () => {
  it.each([FORMATS.ANTIGRAVITY, FORMATS.GEMINI])("emits exactly one usageMetadata frame for %s clients", (clientFormat) => {
    const state = initState(clientFormat);
    const out = [
      TEXT_CHUNK,
      FINISH_CHUNK,
      USAGE_ONLY_CHUNK,
      null
    ].flatMap((chunk) => translateResponse(FORMATS.OPENAI, clientFormat, chunk, state) || []);

    const withUsage = out.filter((item) => item.response?.usageMetadata);
    expect(withUsage).toHaveLength(1);
    expect(withUsage[0].response.usageMetadata).toEqual(EXPECTED_USAGE_METADATA);
    expect(withUsage[0].response.candidates[0].finishReason).toBeUndefined();
    expect(out[out.length - 1], "the usage frame is the last one emitted").toBe(withUsage[0]);
  });

  it("does not repeat usage when the finish chunk already carried it", () => {
    const state = initState(FORMATS.ANTIGRAVITY);
    const out = [
      TEXT_CHUNK,
      { ...FINISH_CHUNK, usage: USAGE },
      USAGE_ONLY_CHUNK,
      null
    ].flatMap((chunk) => translateResponse(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, chunk, state) || []);

    const withUsage = out.filter((item) => item.response?.usageMetadata);
    expect(withUsage).toHaveLength(1);
    expect(withUsage[0].response.candidates[0].finishReason).toBe("STOP");
  });
});

describe("OpenAI → Antigravity client-facing SSE wire frames", () => {
  it.each([FORMATS.ANTIGRAVITY, FORMATS.GEMINI])(
    "%s clients receive the trailing usage frame once, after the terminal candidate",
    async (clientFormat) => {
      const frames = await runWire(clientFormat, [
        sse(TEXT_CHUNK),
        sse(FINISH_CHUNK),
        sse(USAGE_ONLY_CHUNK),
        "data: [DONE]\n\n"
      ]);

      const withUsage = frames.filter((frame) => frame.response?.usageMetadata);
      expect(withUsage, "exactly one usageMetadata frame reaches the client").toHaveLength(1);
      expect(withUsage[0].response.usageMetadata).toEqual(EXPECTED_USAGE_METADATA);
      expect(withUsage[0].response.modelVersion).toBe("gpt-4.1");
      expect(withUsage[0].response.responseId).toBe("chatcmpl-su1");
      expect(withUsage[0].response.candidates[0].finishReason).toBeUndefined();
      expect(withUsage[0].response.candidates[0].content.parts).toEqual([{ text: "" }]);

      // The terminal candidate is emitted once and stays before the usage frame.
      const terminal = frames.filter((frame) => frame.response?.candidates?.[0]?.finishReason);
      expect(terminal).toHaveLength(1);
      expect(frames.indexOf(terminal[0])).toBeLessThan(frames.indexOf(withUsage[0]));
      // The usage frame is the last one: nothing reopens the stream afterwards.
      expect(frames[frames.length - 1]).toBe(withUsage[0]);
      expect(frames[0].response.candidates[0].content.parts[0].text).toBe("hello");
    }
  );

  it("emits the usage once when the finish chunk already carried it", async () => {
    const frames = await runWire(FORMATS.ANTIGRAVITY, [
      sse(TEXT_CHUNK),
      sse({ ...FINISH_CHUNK, usage: USAGE }),
      sse(USAGE_ONLY_CHUNK),
      "data: [DONE]\n\n"
    ]);

    const withUsage = frames.filter((frame) => frame.response?.usageMetadata);
    expect(withUsage).toHaveLength(1);
    expect(withUsage[0].response.candidates[0].finishReason).toBe("STOP");
  });
});
