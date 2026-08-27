import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";

const encoder = new TextEncoder();
const log = { info() {}, warn() {}, error() {}, debug() {} };

function sseResponse(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

async function runCombo(responders, { stream = true, consume = true } = {}) {
  const attempted = [];
  const response = await handleComboChat({
    body: { model: "combo", stream, messages: [{ role: "user", content: "hi" }] },
    models: ["p1/first", "p2/second"],
    handleSingleModel: async (_body, model) => {
      attempted.push(model);
      return responders[model]();
    },
    log,
    comboName: "empty-stream-test",
    comboStrategy: "fallback",
  });
  return { attempted, response, text: consume ? await response.text() : null };
}

beforeEach(() => resetComboRotation());

describe("combo empty-stream failover (#3463)", () => {
  it.each([
    ["no bytes", []],
    ["keepalives only", [": keepalive\n\n"]],
    ["a DONE sentinel only", ["data: [DONE]\n\n"]],
    ["usage without output frames", ['data: {"usage":{"prompt_tokens":4,"completion_tokens":3}}\n\n']],
    ["usage without output tokens", ['data: {"usage":{"prompt_tokens":4,"completion_tokens":0}}\n\n']],
  ])("falls through after %s", async (_label, emptyChunks) => {
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse(emptyChunks),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"fallback"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(text).toContain("fallback");
  });

  it("peeks SSE by response content type even when the request was non-streaming", async () => {
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse([": keepalive\n\n"]),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"forced fallback"}}]}\n\n'])
    }, { stream: false });

    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(text).toContain("forced fallback");
  });

  it("replays every consumed byte when a meaningful frame is split across chunks", async () => {
    const chunks = [
      ": preamble\n\ndata: {\"choices\":[{\"delta\":{\"cont",
      "ent\":\"first wins\"}}]}\n\ndata: [DONE]\n\n",
    ];
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse(chunks),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"wrong"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first"]);
    expect(text).toBe(chunks.join(""));
  });

  it("serves wrapped Gemini content without trying the fallback member", async () => {
    const frame = `data: ${JSON.stringify({
      response: {
        candidates: [{
          content: { parts: [{ text: "wrapped Gemini wins" }] },
          finishReason: "STOP"
        }]
      }
    })}\n\n`;
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse([frame]),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"wrong fallback"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first"]);
    expect(text).toContain("wrapped Gemini wins");
    expect(text).not.toContain("wrong fallback");
  });

  it("replays invalid UTF-8 preamble bytes without rewriting them", async () => {
    const preamble = new Uint8Array([0x3a, 0x20, 0xff, 0xfe, 0x0a, 0x0a]);
    const content = encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
    const expected = new Uint8Array([...preamble, ...content]);
    const response = await handleComboChat({
      body: { stream: true, messages: [{ role: "user", content: "hi" }] },
      models: ["p1/first", "p2/second"],
      handleSingleModel: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(preamble);
          controller.enqueue(content);
          controller.close();
        }
      }), { headers: { "content-type": "text/event-stream" } }),
      log,
      comboName: "byte-replay-test",
      comboStrategy: "fallback"
    });

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
  });

  it("returns 503 when every combo member has an empty stream", async () => {
    const { attempted, response } = await runCombo({
      "p1/first": () => sseResponse([": ping\n\n"]),
      "p2/second": () => sseResponse([]),
    });

    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(response.status).toBe(503);
  });

  it("does not touch a successful non-SSE body", async () => {
    const first = Response.json({ choices: [{ message: { content: "json" } }] });
    const { attempted, response } = await runCombo({
      "p1/first": () => first,
      "p2/second": () => Response.json({ choices: [{ message: { content: "wrong" } }] }),
    }, { consume: false });

    expect(attempted).toEqual(["p1/first"]);
    expect(response).toBe(first);
    expect(first.bodyUsed).toBe(false);
  });

  it("treats null non-stream chat content as empty and falls through", async () => {
    const { attempted, response } = await runCombo({
      "p1/first": () => Response.json({
        choices: [{ message: { role: "assistant", content: null }, finish_reason: "stop" }],
      }),
      "p2/second": () => Response.json({
        choices: [{ message: { role: "assistant", content: "usable" }, finish_reason: "stop" }],
      }),
    }, { stream: false, consume: false });

    expect(attempted).toEqual(["p1/first", "p1/first", "p2/second"]);
    expect((await response.json()).choices[0].message.content).toBe("usable");
  });
});

describe("combo empty-stream peek deadline", () => {
  it("falls through when keepalives continue without meaningful output", async () => {
    vi.resetModules();
    process.env.STREAM_FIRST_CHUNK_TIMEOUT_MS = "40";
    let interval;
    try {
      const { handleComboChat: freshHandleComboChat } = await import("../../open-sse/services/combo.js");
      const attempted = [];
      const response = await freshHandleComboChat({
        body: { stream: true, messages: [{ role: "user", content: "hi" }] },
        models: ["p1/hanging", "p2/second"],
        handleSingleModel: async (_body, model) => {
          attempted.push(model);
          if (model === "p2/second") {
            return sseResponse(['data: {"choices":[{"delta":{"content":"rescued"}}]}\n\n']);
          }
          return new Response(new ReadableStream({
            start(controller) {
              interval = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 5);
            },
            cancel() {clearInterval(interval);}
          }), { headers: { "content-type": "text/event-stream" } });
        },
        log,
        comboName: "deadline-test",
        comboStrategy: "fallback"
      });

      expect(attempted).toEqual(["p1/hanging", "p2/second"]);
      expect(await response.text()).toContain("rescued");
    } finally {
      clearInterval(interval);
      delete process.env.STREAM_FIRST_CHUNK_TIMEOUT_MS;
      vi.resetModules();
    }
  });
});
