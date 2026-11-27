import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetch }));
import { GithubExecutor } from "../../open-sse/executors/github.js";

const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
async function execute(text, { stream = true, status = 200 } = {}) {
  // Split every UTF-8 byte, including multibyte characters and frame separators.
  const bytes = new TextEncoder().encode(text);
  fetch.mockResolvedValueOnce(new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  }), { status, headers: { "content-type": "text/event-stream", "x-test": "preserved" } }));
  return new GithubExecutor().execute({
    model: "gpt-4.1", stream, body: { messages: [{ role: "user", content: "Hello" }] },
    credentials: { accessToken: "offline", copilotToken: "offline" },
  });
}

describe("Copilot chat stream normalization (#864)", () => {
  beforeEach(() => {
    fetch.mockReset();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("repairs missing ids, initial empty choices, and null tool content across byte boundaries", async () => {
    const result = await execute(frame({ choices: [] }) + frame({ choices: [{ index: 0, delta: { content: "héllo" } }] }) +
      frame({ choices: [{ index: 0, delta: { content: null, tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{}" } }] } }] }) +
      frame({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) + "data: [DONE]\n\n");
    const text = await result.response.text();
    const frames = text.trim().split("\n\n");
    const chunks = frames.slice(0, -1).map((line) => JSON.parse(line.slice(6)));
    expect(chunks[0].choices).toEqual([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null, logprobs: null }]);
    expect(chunks[0].id).toMatch(/^chatcmpl-/);
    expect(chunks.map((chunk) => chunk.id)).toEqual(Array(4).fill(chunks[0].id));
    expect(chunks[1].choices[0].delta.content).toBe("héllo");
    expect(chunks[2].choices[0].delta).toEqual({ tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{}" } }] });
    expect(chunks[3].choices[0].finish_reason).toBe("tool_calls");
    expect(frames.at(-1)).toBe("data: [DONE]");
    expect(result.response.headers.get("x-test")).toBe("preserved");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves usage-only trailers and uses an upstream id for later chunks including the EOF tail", async () => {
    const result = await execute(frame({ id: "chatcmpl-upstream", choices: [{ index: 0, delta: { content: "Hi" } }] }) +
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } })}`);
    const chunks = (await result.response.text()).trim().split("\n\n").map((line) => JSON.parse(line.slice(6)));
    expect(chunks[1]).toEqual({ id: "chatcmpl-upstream", choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } });
    expect(chunks).toHaveLength(2);
  });

  it("preserves errors, comments and malformed data without inventing a successful terminal", async () => {
    const wire = ': heartbeat\r\n\r\nevent: error\r\ndata: {"error":{"message":"failed"}}\r\n\r\ndata: broken\n\n';
    expect(await (await execute(wire)).response.text()).toBe(wire);
  });

  it.each([{ stream: false }, { status: 429 }])("leaves non-streaming and failed responses untouched (%j)", async (options) => {
    const wire = frame({ choices: [] });
    expect(await (await execute(wire, options)).response.text()).toBe(wire);
  });
});
