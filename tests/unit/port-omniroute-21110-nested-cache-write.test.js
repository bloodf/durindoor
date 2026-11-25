import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { toResponsesUsage } from "../../open-sse/translator/concerns/usage.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

const terminal = (usage) => ({
  type: "response.completed",
  response: { id: "resp_1", model: "m", status: "completed", output: [], usage },
});

/** Stream a Responses upstream to `client` and return the usage handed to accounting. */
async function savedUsage(client, usage) {
  let saved;
  const stream = createSSETransformStreamWithLogger(
    FORMATS.OPENAI_RESPONSES, client, "openai", null, null, "m", null, { messages: [] },
    (_content, reported) => { saved = reported; },
  );
  const encoder = new TextEncoder();
  const source = new ReadableStream({
    start(controller) {
      for (const event of [{ type: "response.output_text.delta", delta: "ok" }, terminal(usage)]) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  const wire = await new Response(source.pipeThrough(stream)).text();
  return { saved, wire };
}

describe("OmniRoute #21110 nested cache-write counts across streaming translators", () => {
  for (const details of ["input_tokens_details", "prompt_tokens_details"]) {
    const usage = { input_tokens: 1000, output_tokens: 10, [details]: { cached_tokens: 100, cache_write_tokens: 200 } };

    it(`keeps ${details}.cache_write_tokens for a Chat client without adding it to the prompt`, async () => {
      const { saved } = await savedUsage(FORMATS.OPENAI, usage);
      expect(canonicalizeUsage(saved)).toMatchObject({
        prompt_tokens: 1000, cached_tokens: 100, cache_creation_input_tokens: 200,
      });
    });

    it(`reports ${details}.cache_write_tokens to a Claude client apart from fresh input`, async () => {
      const { saved, wire } = await savedUsage(FORMATS.CLAUDE, usage);
      expect(saved).toMatchObject({ cache_read_input_tokens: 100, cache_creation_input_tokens: 200 });
      expect(wire).toContain('"cache_creation_input_tokens":200');
    });
  }

  it("reads the top-level cache_write_tokens alias as part of an inclusive input count", () => {
    expect(toResponsesUsage({ input_tokens: 1000, output_tokens: 10, cache_write_tokens: 200 })).toMatchObject({
      input_tokens: 1000, cache_creation_input_tokens: 200,
    });
  });

  it("keeps a reported zero ahead of a nested positive cache write", () => {
    const translated = toResponsesUsage({
      input_tokens: 1000, output_tokens: 10, cached_tokens: 100, cache_creation_input_tokens: 0,
      input_tokens_details: { cache_write_tokens: 200 },
    });
    expect(translated.input_tokens).toBe(1000);
    expect(translated.cache_creation_input_tokens).toBeUndefined();
  });

  it("is stable when applied twice", () => {
    const once = toResponsesUsage({ input_tokens: 1000, output_tokens: 10, input_tokens_details: { cache_write_tokens: 200 } });
    expect(toResponsesUsage(once)).toEqual(once);
  });

  it("drops a stale nested alias when flat cache fields select exclusive normalization", () => {
    const once = toResponsesUsage({
      input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 4,
      input_tokens_details: { cache_write_tokens: 20 },
    });
    expect(once.input_tokens_details).toEqual({ cached_tokens: 4 });
    expect(toResponsesUsage(once)).toEqual(once);
  });
});
