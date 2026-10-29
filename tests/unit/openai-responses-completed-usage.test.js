import "../translator/registerAll.js";
import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

const finish = (usage) => ({ id: "c1", choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }], ...(usage ? { usage } : {}) });
const completed = (events) => events.filter((event) => event.event === "response.completed");

function openChatResponsesStream(options = {}) {
  const stream = createSSEStream({ targetFormat: FORMATS.OPENAI, sourceFormat: FORMATS.OPENAI_RESPONSES, ...options });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const frames = [];
  const reading = (async () => {
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      frames.push(decoder.decode(value, { stream: true }));
    }
  })();
  return {
    writer, reader, reading,
    text: () => frames.join(""),
    write: (chunk) => writer.write(new TextEncoder().encode(`data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`)),
    close: async () => { await writer.close(); await reading; }
  };
}

describe("Responses completion waits for real usage", () => {
  it.each([
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    { prompt_tokens: 30 },
    { prompt_tokens: 30.5, completion_tokens: 2 },
    { prompt_tokens: -1, completion_tokens: 2 }
  ])("does not freeze placeholder or malformed usage %j", (placeholder) => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    expect(completed(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, finish(placeholder), state))).toEqual([]);
    const events = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      choices: [], usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 999 }
    }, state);
    expect(completed(events).map((event) => event.data.response.usage)).toEqual([
      { input_tokens: 300, output_tokens: 20, total_tokens: 320 }
    ]);
  });

  it("keeps usage isolated from native state overwritten by a pivot hop", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      choices: [{ delta: { content: "Hi" } }],
      usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } }
    }, state);
    state.usage = { input_tokens: 7, output_tokens: 1 };
    const response = completed(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, finish(), state))[0].data.response;
    expect(response.usage).toEqual({ input_tokens: 120, output_tokens: 30, total_tokens: 150,
      cached_tokens: 40, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 5 } });
  });

  it("preserves cache-creation-only and audio details in the Codex usage contract", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const response = completed(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, finish({
      prompt_tokens: 12, completion_tokens: 7,
      prompt_tokens_details: { cache_creation_tokens: 2, audio_tokens: 1 },
      completion_tokens_details: { accepted_prediction_tokens: 3 }
    }), state))[0].data.response;
    expect(response.usage).toMatchObject({
      input_tokens: 12, output_tokens: 7, total_tokens: 19,
      input_tokens_details: { cached_tokens: 0, cache_creation_tokens: 2, audio_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 0, accepted_prediction_tokens: 3 }
    });
  });

  it("includes cache-inclusive Claude usage across the OpenAI pivot", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const chunks = [
      { type: "message_start", message: { id: "msg1", usage: { input_tokens: 1000, cache_read_input_tokens: 200, cache_creation_input_tokens: 30, output_tokens: 1 } } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 50 } },
      { type: "message_stop" }
    ];
    const events = chunks.flatMap((chunk) => translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, chunk, state));
    expect(completed(events)).toHaveLength(1);
    expect(completed(events)[0].data.response.usage).toMatchObject({ input_tokens: 1230, output_tokens: 50, total_tokens: 1280, input_tokens_details: { cached_tokens: 200 } });
  });

  it("completes at [DONE] before transport EOF without inventing usage", async () => {
    const stream = openChatResponsesStream();
    try {
      await stream.write(finish());
      expect(stream.text()).not.toContain('"type":"response.completed"');
      await stream.write("[DONE]");
      const completions = stream.text().split("\n").filter((line) => line.startsWith("data:") && line.includes('"type":"response.completed"'));
      expect(completions).toHaveLength(1);
      expect(JSON.parse(completions[0].slice(6)).response).not.toHaveProperty("usage");
    } finally { await stream.close(); }
  });

  it("delivers real trailer usage once before transport EOF", async () => {
    const stream = openChatResponsesStream();
    try {
      await stream.write(finish({ prompt_tokens: 0, completion_tokens: 0 }));
      expect(stream.text()).not.toContain('"type":"response.completed"');
      await stream.write({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 999 } });
      await stream.write("[DONE]");
      const completions = stream.text().split("\n").filter((line) => line.startsWith("data:") && line.includes('"type":"response.completed"'));
      expect(completions).toHaveLength(1);
      expect(JSON.parse(completions[0].slice(6)).response.usage).toEqual({ input_tokens: 12, output_tokens: 0, total_tokens: 12 });
    } finally { await stream.close(); }
  });
});
