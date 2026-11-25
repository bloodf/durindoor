// #1073: OmniRoute #18363 (pinned a49276e) keeps reasoning wire fields independent while
// streaming redaction rewrites visible text. This checks the existing DurinDoor
// responseMasking pipeline for the same structural guarantee, offline.
//
// Only ordinary synthetic text is used. contentMasking's rule set is replaced by a
// trivial deterministic rewrite of the marker `ORCHID-<digits>`, so the test exercises
// the response walker, carry and synthesized-frame logic without any credential or PII
// shaped input. `normalizeMaskingMode` stays the real implementation.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/services/contentMasking.js", async (importOriginal) => {
  const actual = await importOriginal();
  const MARKER = /ORCHID-\d+/g;
  return {
    ...actual,
    maskText(text, { replace = true } = {}, counts = {}) {
      if (typeof text !== "string" || !text) return text;
      const hits = text.match(MARKER);
      if (!hits) return text;
      counts.marker = (counts.marker ?? 0) + hits.length;
      return replace ? text.replace(MARKER, "[MASKED]") : text;
    },
  };
});

const { applyResponseMasking } = await import("../../open-sse/services/responseMasking.js");

const MASK = { mode: "mask" };
const WARN = { mode: "warn" };
const TOKEN = "ORCHID-4821";
const clone = (value) => JSON.parse(JSON.stringify(value));

const jsonResult = (body) => ({
  success: true,
  response: new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
});
const sseText = (payloads) => payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") + "data: [DONE]\n\n";
// Deliver the stream in small fixed-size pieces so frames and the token straddle chunks.
const sseResult = (text, size = 23) => {
  const enc = new TextEncoder();
  let at = 0;
  const body = new ReadableStream({
    pull(c) {
      if (at >= text.length) return c.close();
      c.enqueue(enc.encode(text.slice(at, at + size)));
      at += size;
    },
  });
  return { success: true, response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }) };
};
const payloadsOf = (text) => text.split(/\n\n/)
  .map((f) => f.split("\n").find((l) => l.startsWith("data: "))?.slice(6))
  .filter((d) => d && d !== "[DONE]")
  .map((d) => JSON.parse(d));
const maskJson = async (body, config = MASK) => JSON.parse(await (await applyResponseMasking(jsonResult(body), config)).response.text());
const maskStream = async (payloads, config = MASK, size) => {
  const raw = sseText(payloads);
  const text = await (await applyResponseMasking(sseResult(raw, size), config)).response.text();
  return { raw, text, events: payloadsOf(text) };
};
const count = (haystack, needle) => haystack.split(needle).length - 1;

describe("non-streaming bodies keep reasoning and signed fields", () => {
  it("Chat Completions: only message.content changes, key order included", async () => {
    const body = {
      id: "chatcmpl-1", object: "chat.completion", model: "m",
      choices: [{
        index: 0, finish_reason: "stop",
        message: {
          role: "assistant", content: `see ${TOKEN} here`,
          reasoning_content: `plan ${TOKEN}`, reasoning: "short plan",
          reasoning_details: [{ type: "reasoning.encrypted", id: "rd_1", index: 0, format: "x-v1", data: "c2lnbmVk" }],
          refusal: null,
        },
      }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7, completion_tokens_details: { reasoning_tokens: 2 } },
    };
    const out = await maskJson(body);
    const expected = clone(body);
    expected.choices[0].message.content = "see [MASKED] here";
    expect(out).toEqual(expected);
    expect(JSON.stringify(out)).toBe(JSON.stringify(expected));
  });

  it("Chat Completions: array content masks text parts and leaves siblings alone", async () => {
    const body = { choices: [{ message: { role: "assistant", reasoning_content: "r", content: [{ type: "text", text: `a ${TOKEN}` }, { type: "refusal", refusal: "n/a" }] } }] };
    const expected = clone(body);
    expected.choices[0].message.content[0].text = "a [MASKED]";
    expect(await maskJson(body)).toEqual(expected);
  });

  it("Claude Messages: thinking, signature, redacted_thinking and tool_use stay intact", async () => {
    const body = {
      id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: `reasoning ${TOKEN}`, signature: "c2lnLTE=" },
        { type: "redacted_thinking", data: "b3BhcXVl" },
        { type: "text", text: `answer ${TOKEN}` },
        { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: TOKEN } },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
    };
    const expected = clone(body);
    expected.content[2].text = "answer [MASKED]";
    const out = await maskJson(body);
    expect(out).toEqual(expected);
    expect(JSON.stringify(out)).toBe(JSON.stringify(expected));
  });

  it("Responses: reasoning items keep id, summary and encrypted_content; message text and output_text change", async () => {
    const body = {
      object: "response", id: "resp_1", status: "completed",
      output: [
        { id: "rs_1", type: "reasoning", summary: [{ type: "summary_text", text: `summary ${TOKEN}` }], encrypted_content: "ZW5jcnlwdGVk" },
        { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: `answer ${TOKEN}`, annotations: [] }] },
      ],
      output_text: `answer ${TOKEN}`,
      usage: { output_tokens_details: { reasoning_tokens: 5 } },
    };
    const expected = clone(body);
    expected.output[1].content[0].text = "answer [MASKED]";
    expected.output_text = "answer [MASKED]";
    const out = await maskJson(body);
    // The reasoning summary is not visible answer text; existing policy leaves it unmasked.
    expect(out.output[0]).toEqual(body.output[0]);
    expect(out).toEqual(expected);
  });

  it("Gemini: thought parts and thoughtSignature on every part kind are preserved", async () => {
    const body = {
      response: {
        candidates: [{
          index: 0, finishReason: "STOP",
          content: {
            role: "model",
            parts: [
              { text: `thinking ${TOKEN}`, thought: true, thoughtSignature: "U0lHMQ==" },
              { text: `visible ${TOKEN}`, thoughtSignature: "U0lHMg==" },
              { functionCall: { name: "lookup", args: { q: TOKEN } }, thoughtSignature: "U0lHMw==" },
            ],
          },
        }],
        usageMetadata: { thoughtsTokenCount: 4 },
      },
    };
    const expected = clone(body);
    expected.response.candidates[0].content.parts[1].text = "visible [MASKED]";
    const out = await maskJson(body);
    expect(out).toEqual(expected);
    expect(JSON.stringify(out)).toBe(JSON.stringify(expected));
  });

  it("a body with no reasoning fields does not gain any", async () => {
    const out = await maskJson({ choices: [{ index: 0, message: { role: "assistant", content: `x ${TOKEN}` } }] });
    expect(Object.keys(out.choices[0].message)).toEqual(["role", "content"]);
  });

  it("a body with nothing to rewrite stays byte-identical, with reasoning fields present", async () => {
    const raw = JSON.stringify({ choices: [{ message: { content: "plain", reasoning_content: "think" } }] });
    const result = { success: true, response: new Response(raw, { headers: { "content-type": "application/json" } }) };
    expect(await (await applyResponseMasking(result, MASK)).response.text()).toBe(raw);
  });
});

describe("Chat Completions streams", () => {
  const base = { id: "chatcmpl-1", object: "chat.completion.chunk", model: "m" };
  const chunk = (delta, extra = {}) => ({ ...base, choices: [{ index: 0, delta, finish_reason: null }], ...extra });
  const frames = [
    chunk({ role: "assistant", reasoning_content: "first thought. " }),
    chunk({ reasoning_content: "second thought. ", reasoning: "short" }),
    chunk({ content: "answer ORCHID-" }),
    chunk({ reasoning_content: "third thought.", content: "4821 and more" }),
    chunk({ reasoning_details: [{ type: "reasoning.encrypted", id: "rd_1", index: 0, data: "c2lnbmVk" }] }),
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { total_tokens: 9, completion_tokens_details: { reasoning_tokens: 3 } } },
  ];

  it("masks a token split across chunks while every reasoning field arrives once, unchanged", async () => {
    const { text, events } = await maskStream(frames);
    const deltas = events.map((e) => e.choices?.[0]?.delta ?? {});
    expect(deltas.map((d) => d.content ?? "").join("")).toBe("answer [MASKED] and more");
    expect(deltas.map((d) => d.reasoning_content ?? "").join("")).toBe("first thought. second thought. third thought.");
    expect(deltas.map((d) => d.reasoning ?? "").join("")).toBe("short");
    expect(deltas.flatMap((d) => d.reasoning_details ?? [])).toEqual(frames[4].choices[0].delta.reasoning_details);
    expect(text).not.toContain(TOKEN);
    expect(count(text, "first thought. ")).toBe(1);
    expect(count(text, "c2lnbmVk")).toBe(1);
  });

  it("original frames keep their keys; only the content value is held back", async () => {
    const { events } = await maskStream(frames);
    const reasoningFrames = events.filter((e) => e.choices?.[0]?.delta && ("reasoning_content" in e.choices[0].delta || "reasoning_details" in e.choices[0].delta));
    expect(reasoningFrames).toHaveLength(4);
    reasoningFrames.forEach((frame) => {
      const original = frames.find((f) => f.choices[0].delta.reasoning_content === frame.choices[0].delta.reasoning_content
        && JSON.stringify(f.choices[0].delta.reasoning_details) === JSON.stringify(frame.choices[0].delta.reasoning_details));
      const { content: _held, ...gotDelta } = frame.choices[0].delta;
      const { content: _orig, ...wantDelta } = original.choices[0].delta;
      expect(gotDelta).toEqual(wantDelta);
      expect(Object.keys(frame)).toEqual(Object.keys(original));
    });
  });

  it("synthesized flush frames carry only masked text: no reasoning, no usage, no finish reason", async () => {
    const { events } = await maskStream(frames);
    const synthesized = events.filter((e) => e.choices?.[0]?.delta && Object.keys(e.choices[0].delta).join() === "content" && e.choices[0].delta.content !== "");
    expect(synthesized.length).toBeGreaterThan(0);
    synthesized.forEach((e) => {
      expect(e.choices[0].finish_reason).toBeNull();
      expect("usage" in e).toBe(false);
    });
    // The terminal frame keeps its finish reason and usage, including reasoning token counts.
    const last = events[events.length - 1];
    expect(last.choices[0].finish_reason).toBe("stop");
    expect(last.usage).toEqual(frames[5].usage);
  });

  it("frames without content or reasoning fields do not gain them", async () => {
    const { events } = await maskStream([chunk({ role: "assistant" }), chunk({ content: `a ${TOKEN}` }), frames[5]]);
    expect("reasoning_content" in events[0].choices[0].delta).toBe(false);
    expect(events.some((e) => e.choices?.[0]?.delta && ("reasoning" in e.choices[0].delta || "reasoning_content" in e.choices[0].delta))).toBe(false);
    expect(events.map((e) => e.choices?.[0]?.delta?.content ?? "").join("")).toBe("a [MASKED]");
  });
});

describe("Claude Messages streams", () => {
  const frames = [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], usage: { input_tokens: 2, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: `reasoning ${TOKEN}` } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "c2lnLTE=" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "b3BhcXVl" } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "answer ORCHID-" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "4821 done" } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ];

  it("masks the text block and leaves thinking, signature and redacted blocks intact and in order", async () => {
    const { text, events } = await maskStream(frames);
    const isText = (e) => e.delta?.type === "text_delta";
    const others = events.filter((e) => !isText(e));
    expect(others).toEqual(frames.filter((f) => !isText(f)));
    expect(events.filter(isText).map((e) => e.delta.text).join("")).toBe("answer [MASKED] done");
    // Signed thinking is not visible answer text, so it keeps its original value; only text deltas are rewritten.
    expect(events.filter(isText).some((e) => e.delta.text.includes(TOKEN))).toBe(false);
    expect(count(text, "c2lnLTE=")).toBe(1);
    expect(count(text, "b3BhcXVl")).toBe(1);
    // The text is flushed before its block stops, so no text arrives after content_block_stop.
    const stopAt = events.findIndex((e) => e.type === "content_block_stop" && e.index === 2);
    expect(events.slice(stopAt).some(isText)).toBe(false);
  });
});

describe("Responses streams", () => {
  const reasoningItem = { id: "rs_1", type: "reasoning", summary: [], encrypted_content: "ZW5jcnlwdGVk" };
  const doneReasoning = { ...reasoningItem, summary: [{ type: "summary_text", text: "summary text" }] };
  const message = (text) => ({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] });
  const frames = [
    { type: "response.created", sequence_number: 0, response: { id: "resp_1", status: "in_progress", output: [] } },
    { type: "response.output_item.added", sequence_number: 1, output_index: 0, item: reasoningItem },
    { type: "response.reasoning_summary_text.delta", sequence_number: 2, output_index: 0, item_id: "rs_1", summary_index: 0, delta: "summary text" },
    { type: "response.reasoning_summary_text.done", sequence_number: 3, output_index: 0, item_id: "rs_1", summary_index: 0, text: "summary text" },
    { type: "response.output_item.done", sequence_number: 4, output_index: 0, item: doneReasoning },
    { type: "response.output_item.added", sequence_number: 5, output_index: 1, item: { ...message(""), content: [] } },
    { type: "response.output_text.delta", sequence_number: 6, output_index: 1, content_index: 0, item_id: "msg_1", delta: "answer ORCHID-" },
    { type: "response.output_text.delta", sequence_number: 7, output_index: 1, content_index: 0, item_id: "msg_1", delta: "4821 done" },
    { type: "response.output_text.done", sequence_number: 8, output_index: 1, content_index: 0, item_id: "msg_1", text: `answer ${TOKEN} done` },
    { type: "response.output_item.done", sequence_number: 9, output_index: 1, item: message(`answer ${TOKEN} done`) },
    { type: "response.completed", sequence_number: 10, response: { id: "resp_1", status: "completed", output: [doneReasoning, message(`answer ${TOKEN} done`)], usage: { output_tokens_details: { reasoning_tokens: 3 } } } },
  ];

  it("keeps reasoning items, summary events and encrypted_content, and masks only message text", async () => {
    const { text, events } = await maskStream(frames);
    const isReasoning = (e) => String(e.type).startsWith("response.reasoning_summary") || e.item?.type === "reasoning";
    const noSeq = (e) => ({ ...e, sequence_number: undefined });
    expect(events.filter(isReasoning).map(noSeq)).toEqual(frames.filter(isReasoning).map(noSeq));
    const completed = events.find((e) => e.type === "response.completed");
    expect(completed.response.output[0]).toEqual(doneReasoning);
    expect(completed.response.usage).toEqual(frames[10].response.usage);
    expect(completed.response.output[1].content[0].text).toBe("answer [MASKED] done");
    expect(text).not.toContain(TOKEN);
    expect(events.filter((e) => e.type === "response.output_text.delta").map((e) => e.delta).join("")).toBe("answer [MASKED] done");
    expect(events.find((e) => e.type === "response.output_text.done").text).toBe("answer [MASKED] done");
    expect(count(text, "ZW5jcnlwdGVk")).toBe(3);
  });

  it("renumbers sequence_number monotonically after any synthesized frame", async () => {
    const { events } = await maskStream(frames);
    const seq = events.map((e) => e.sequence_number);
    expect(seq.every(Number.isInteger)).toBe(true);
    seq.slice(1).forEach((n, i) => expect(n).toBeGreaterThan(seq[i]));
  });
});

describe("Gemini streams", () => {
  const frames = [
    { candidates: [{ index: 0, content: { role: "model", parts: [{ text: "thinking one", thought: true, thoughtSignature: "U0lHMQ==" }] } }], usageMetadata: { thoughtsTokenCount: 1 } },
    { candidates: [{ index: 0, content: { role: "model", parts: [{ text: "visible ORCHID-", thoughtSignature: "U0lHMg==" }] } }] },
    { candidates: [{ index: 0, content: { role: "model", parts: [{ text: "4821 text" }] } }] },
    { candidates: [{ index: 0, finishReason: "STOP", content: { role: "model", parts: [{ text: "more thinking", thought: true }] } }], usageMetadata: { thoughtsTokenCount: 4 } },
  ];

  it("masks visible text; thought parts and every thoughtSignature arrive once with unchanged values", async () => {
    const { text, events } = await maskStream(frames);
    const parts = events.flatMap((e) => e.candidates?.[0]?.content?.parts ?? []);
    expect(parts.filter((p) => !p.thought).map((p) => p.text).join("")).toBe("visible [MASKED] text");
    expect(parts.filter((p) => p.thought)).toEqual([
      { text: "thinking one", thought: true, thoughtSignature: "U0lHMQ==" },
      { text: "more thinking", thought: true },
    ]);
    expect(text).not.toContain(TOKEN);
    expect(count(text, "U0lHMQ==")).toBe(1);
    expect(count(text, "U0lHMg==")).toBe(1);
  });

  it("synthesized frames hold only a masked text part: no thought, signature, finishReason or usage", async () => {
    const { events } = await maskStream(frames);
    const flushed = events.filter((e) => {
      const parts = e.candidates?.[0]?.content?.parts ?? [];
      return parts.length === 1 && !parts[0].thought && parts[0].text !== "";
    });
    expect(flushed).toHaveLength(1);
    expect(flushed[0].candidates[0].content.parts).toEqual([{ text: "visible [MASKED] text" }]);
    expect(flushed[0].candidates[0].finishReason).toBeUndefined();
    expect(flushed[0].usageMetadata).toBeUndefined();
    // The part that arrived with its signature keeps it; the held-back text moves to the flushed part.
    const signed = events.flatMap((e) => e.candidates?.[0]?.content?.parts ?? []).find((p) => p.thoughtSignature === "U0lHMg==");
    expect(signed).toEqual({ text: "", thoughtSignature: "U0lHMg==" });
    // The terminal frame still carries its finishReason and usageMetadata, after the flushed text.
    const last = events[events.length - 1];
    expect(last.candidates[0].finishReason).toBe("STOP");
    expect(last.usageMetadata).toEqual({ thoughtsTokenCount: 4 });
    expect(events.indexOf(flushed[0])).toBeLessThan(events.length - 1);
  });

  it("keeps the {response: ...} envelope fields", async () => {
    const wrapped = frames.map((f) => ({ response: { ...f, responseId: "r1", modelVersion: "m" }, traceId: "t1" }));
    const { events } = await maskStream(wrapped);
    events.forEach((e) => expect(e.response.candidates).toHaveLength(1));
    expect(events.filter((e) => e.response.responseId === "r1").length).toBe(events.length);
    expect(events.every((e) => e.traceId === "t1")).toBe(true);
  });
});

describe("modes that must not alter reasoning shape", () => {
  it("warn leaves a reasoning stream byte-identical", async () => {
    const frames = [
      { choices: [{ index: 0, delta: { reasoning_content: "think", content: `x ${TOKEN}` } }] },
      { choices: [{ index: 0, delta: { reasoning_details: [{ type: "reasoning.encrypted", data: "c2ln" }] }, finish_reason: "stop" }] },
    ];
    const { raw, text } = await maskStream(frames, WARN);
    expect(text).toBe(raw);
  });

  it("warn leaves a reasoning JSON body byte-identical", async () => {
    const raw = JSON.stringify({ type: "message", content: [{ type: "thinking", thinking: "t", signature: "c2ln" }, { type: "text", text: TOKEN }] });
    const result = { success: true, response: new Response(raw, { headers: { "content-type": "application/json" } }) };
    expect(await (await applyResponseMasking(result, WARN)).response.text()).toBe(raw);
  });

  it("off returns the same result object", async () => {
    const result = jsonResult({ choices: [{ message: { content: TOKEN, reasoning_content: "r" } }] });
    expect(await applyResponseMasking(result, { mode: "off" })).toBe(result);
  });
});
