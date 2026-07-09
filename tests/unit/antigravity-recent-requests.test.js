import "../translator/registerAll.js";
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

describe("passthrough terminal events", () => {
  it("waits for OpenAI include_usage chunk before completing", async () => {
    let completed = null;
    const stream = createPassthroughStreamWithLogger(
      "openai-compatible",
      null,
      null,
      "model",
      "conn-1",
      { stream_options: { include_usage: true } },
      (content, usage) => { completed = { content, usage }; },
      null,
    );
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const readAll = (async () => { while (!(await reader.read()).done) {} })();

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify({
      choices: [{ delta: { content: "answer" }, finish_reason: "stop" }],
    })}\n\n`));
    expect(completed).toBeNull();

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify({
      choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    })}\n\n`));
    await writer.close();
    await readAll;

    expect(completed?.content?.content).toBe("answer");
    expect(completed?.usage?.estimated).not.toBe(true);
    expect(completed?.usage?.completion_tokens).toBe(1);
  });
  it("waits for translated OpenAI include_usage chunk before completing", async () => {
    let completed = null;
    const stream = createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "openai-compatible",
      null,
      null,
      "model",
      "conn-1",
      { stream: true, stream_options: { include_usage: true } },
      (content, usage) => { completed = { content, usage }; },
      null,
    );
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const readAll = (async () => { while (!(await reader.read()).done) {} })();

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify({
      choices: [{ delta: { content: "translated answer" }, finish_reason: "stop" }],
    })}\n\n`));
    expect(completed).toBeNull();

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify({
      choices: [], usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 },
    })}\n\n`));
    await writer.close();
    await readAll;

    expect(completed?.content?.content).toBe("translated answer");
    expect(completed?.usage).toMatchObject({ prompt_tokens: 7, completion_tokens: 4 });
    expect(completed?.usage?.estimated).not.toBe(true);
  });
});

describe("Gemini raw thought passthrough", () => {
  it("keeps thought parts out of completed visible content", async () => {
    let completed = null;
    const stream = createPassthroughStreamWithLogger(
      "antigravity", null, null, "model", "conn-1", {},
      (content) => { completed = content; }, null,
    );
    await writeAndCollect(stream, [`data: ${JSON.stringify({ response: {
      candidates: [{ content: { parts: [
        { thought: true, text: "private thought" },
        { text: "visible answer" },
      ] }, finishReason: "STOP" }],
    } })}\n\n`]);

    expect(completed).toEqual({ content: "visible answer", thinking: "private thought" });
  });
});
