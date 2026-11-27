import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

const data = (value) => `data: ${JSON.stringify(value)}\n\n`;
const done = "data: [DONE]\n\n";
const frame = (delta, finish_reason = "") => data({
  id: "chatcmpl-5902",
  model: "glm-5.2",
  created: 1,
  choices: [{ index: 0, delta, finish_reason }],
});

async function run(...parts) {
  const encoder = new TextEncoder();
  globalThis.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  }), {
    headers: {
      "content-type": "text/event-stream",
      "content-length": "999",
      "content-encoding": "gzip",
    },
  }));
  const { response } = await new CodeBuddyExecutor().execute({
    model: "glm-5.2",
    body: { messages: [] },
    stream: true,
    credentials: { accessToken: "cb-test-token" },
  });
  expect(response.headers.has("content-length")).toBe(false);
  expect(response.headers.has("content-encoding")).toBe(false);
  const output = await response.text();
  return {
    output,
    chunks: [...output.matchAll(/^data: (\{.+\})$/gm)].map((match) => JSON.parse(match[1])),
  };
}

describe("9router #5902 CodeBuddy SSE completion", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emits one terminal stop reason and single DONE sentinel even when DONE is split or duplicated", async () => {
    const usage = { prompt_tokens: 8, completion_tokens: 2 };
    const { output, chunks } = await run(
      frame({ content: "hello" }),
      data({ choices: [], usage }),
      "data: [DO",
      "NE]\n\n",
      done,
    );
    expect(chunks[0].choices[0].finish_reason).toBeNull();
    expect(chunks.at(-1)).toMatchObject({ choices: [{ finish_reason: "stop" }], usage });
    expect(output.match(/\[DONE\]/g)).toHaveLength(1);
  });

  it("retains an explicit upstream length finish when followed by an empty delta", async () => {
    const { chunks } = await run(frame({ content: "partial" }), frame({}, "length"), frame({}), done);
    expect(chunks.map((chunk) => chunk.choices[0].finish_reason)).toEqual([null, "length", null]);
  });

  it("synthesizes tool_calls finish_reason for a cleanly terminated tool turn", async () => {
    const { chunks } = await run(frame({ tool_calls: [{ index: 0, id: "call_x" }] }), done);
    expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("does not invent a successful finish when an upstream error interrupts the turn", async () => {
    const { chunks } = await run(
      frame({ content: "partial" }),
      data({ error: { message: "upstream failed" } }),
      done,
    );
    expect(chunks.at(-1)).toEqual({ error: { message: "upstream failed" } });
    expect(chunks.some((chunk) => chunk.choices?.[0]?.finish_reason)).toBe(false);
  });

  it("handles CRLF frame boundaries cleanly via sseFrames", async () => {
    const crlfChunk = `data: ${JSON.stringify({
      id: "chatcmpl-crlf",
      model: "glm-5.2",
      created: 2,
      choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "" }],
    })}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const { output, chunks } = await run(crlfChunk);
    expect(chunks[0].choices[0].finish_reason).toBeNull();
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
    expect(output.match(/\[DONE\]/g)).toHaveLength(1);
  });
});
