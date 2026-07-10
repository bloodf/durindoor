import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  createPassthroughStreamWithLogger,
  createSSETransformStreamWithLogger,
} from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
}));

async function writeAndCollect(transform, chunks) {
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const readAll = (async () => {
    const out = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
    }
    return out;
  })();

  for (const chunk of chunks) {
    await writer.write(new TextEncoder().encode(chunk));
  }
  await writer.close();
  return await readAll;
}

describe("Antigravity Recent Requests usage", () => {
  it("does not duplicate an upstream OpenAI DONE sentinel during passthrough flush", async () => {
    const stream = createPassthroughStreamWithLogger(
      "openai",
      null,
      null,
      "gpt-4.1",
      "conn-openai-done",
      { messages: [{ role: "user", content: "hello" }], stream: true },
      null,
      null,
    );

    const event = {
      id: "chatcmpl-done",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    };
    const chunks = await writeAndCollect(stream, [
      `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,
    ]);
    const output = chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");

    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("recognizes an upstream OpenAI DONE sentinel buffered without a final newline", async () => {
    const stream = createPassthroughStreamWithLogger(
      "openai",
      null,
      null,
      "gpt-4.1",
      "conn-openai-buffered-done",
      { messages: [{ role: "user", content: "hello" }], stream: true },
      null,
      null,
    );

    const chunks = await writeAndCollect(stream, ["data: [DONE]"]);
    const output = chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");

    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("does not append OpenAI DONE sentinels for agy native passthrough streams", async () => {
    const stream = createPassthroughStreamWithLogger(
      "agy",
      null,
      null,
      "gemini-3.1-flash-image",
      "conn-1",
      { request: { contents: [{ role: "user", parts: [{ text: "draw" }] }] } },
      null,
      null,
    );

    const event = {
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "AGY_NATIVE_OK" }],
          },
          finishReason: "STOP",
        }],
      },
    };

    const chunks = await writeAndCollect(stream, [`data: ${JSON.stringify(event)}\n\n`]);
    const output = chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");

    expect(output).toContain("AGY_NATIVE_OK");
    expect(output).not.toContain("[DONE]");
  });

  it("finalizes native Antigravity usage when the final chunk arrives before stream close", async () => {
    let completed = null;
    const stream = createPassthroughStreamWithLogger(
      "antigravity",
      null,
      null,
      "claude-opus-4-6-thinking",
      "conn-1",
      { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } },
      (content, usage) => {
        completed = { content, usage };
      },
      null,
    );

    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const readOne = reader.read();

    const event = {
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "AG_NATIVE_USAGE_OK" }],
          },
          finishReason: "STOP",
        }],
        usageMetadata: {
          promptTokenCount: 18,
          candidatesTokenCount: 12,
          totalTokenCount: 30,
        },
      },
    };

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    await readOne;

    expect(completed?.content?.content).toBe("AG_NATIVE_USAGE_OK");
    expect(completed?.usage).toMatchObject({
      prompt_tokens: 18,
      completion_tokens: 12,
      total_tokens: 30,
    });

    await writer.abort();
    await reader.cancel().catch(() => {});
  });

  it("finalizes translated Responses API Antigravity usage when the final chunk arrives before stream close", async () => {
    let completed = null;
    const stream = createSSETransformStreamWithLogger(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI_RESPONSES,
      "antigravity",
      null,
      null,
      "gemini-pro-agent",
      "conn-1",
      { input: "hello", stream: true },
      (content, usage) => {
        completed = { content, usage };
      },
      null,
    );

    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const readOne = reader.read();

    const event = {
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "AG_RESPONSES_USAGE_OK" }],
          },
          finishReason: "STOP",
        }],
        usageMetadata: {
          promptTokenCount: 21,
          candidatesTokenCount: 13,
          totalTokenCount: 34,
        },
      },
    };

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    await readOne;

    expect(completed?.content?.content).toBe("AG_RESPONSES_USAGE_OK");
    expect(completed?.usage).toMatchObject({
      prompt_tokens: 21,
      completion_tokens: 13,
      total_tokens: 34,
    });

    await writer.abort();
    await reader.cancel().catch(() => {});
  });

  it("waits for trailing OpenAI include_usage before completing a translated stream", async () => {
    let completed = null;
    const stream = createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "openai",
      null,
      null,
      "gpt-4.1",
      "conn-openai-usage",
      {
        messages: [{ role: "user", content: "hello" }],
        stream: true,
        stream_options: { include_usage: true },
      },
      (content, usage) => {
        completed = { content, usage };
      },
      null,
    );

    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const drain = (async () => {
      while (!(await reader.read()).done) {
        // Drain translated frames so TransformStream backpressure cannot hide completion.
      }
    })();
    const finishChunk = {
      id: "chatcmpl-usage",
      object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { content: "USAGE_AFTER_FINISH" },
        finish_reason: "stop",
      }],
      usage: null,
    };
    const usageChunk = {
      id: "chatcmpl-usage",
      object: "chat.completion.chunk",
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    };

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
    expect(completed).toBeNull();

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(usageChunk)}\n\n`));
    expect(completed?.content?.content).toBe("USAGE_AFTER_FINISH");
    expect(completed?.usage).toMatchObject({
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
    });

    await writer.abort();
    await reader.cancel().catch(() => {});
    await drain.catch(() => {});
  });

  it("estimates usage for Antigravity passthrough content when upstream omits usageMetadata", async () => {
    let completed = null;
    const stream = createPassthroughStreamWithLogger(
      "antigravity",
      null,
      null,
      "gemini-pro-agent",
      "conn-1",
      { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } },
      (content, usage) => {
        completed = { content, usage };
      },
      null,
    );

    const event = {
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "A useful Antigravity response." }],
          },
          finishReason: "STOP",
        }],
      },
    };

    await writeAndCollect(stream, [`data: ${JSON.stringify(event)}\n\n`]);

    expect(completed?.content?.content).toBe("A useful Antigravity response.");
    expect(completed?.usage?.prompt_tokens).toBeGreaterThan(0);
    expect(completed?.usage?.completion_tokens).toBeGreaterThan(0);
    expect(completed?.usage?.estimated).toBe(true);
  });

  it("estimates usage for translated Antigravity wrapped content when upstream omits usageMetadata", async () => {
    let completed = null;
    const stream = createSSETransformStreamWithLogger(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      "antigravity",
      null,
      null,
      "claude-opus-4-6-thinking",
      "conn-1",
      { messages: [{ role: "user", content: "hello" }] },
      (content, usage) => {
        completed = { content, usage };
      },
      null,
    );

    const event = {
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "Translated Antigravity response." }],
          },
          finishReason: "STOP",
        }],
      },
    };

    await writeAndCollect(stream, [`data: ${JSON.stringify(event)}\n\n`]);

    expect(completed?.content?.content).toBe("Translated Antigravity response.");
    expect(completed?.usage?.prompt_tokens).toBeGreaterThan(0);
    expect(completed?.usage?.completion_tokens).toBeGreaterThan(0);
    expect(completed?.usage?.estimated).toBe(true);
  });
});
