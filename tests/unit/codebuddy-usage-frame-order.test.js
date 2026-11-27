import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { createSseFrameReader } from "../../open-sse/utils/sseFrames.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveUsageStats: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const usage = { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 };

// CodeBuddy sends the content chunk with an empty finish reason, then a
// usage-only frame, then the [DONE] sentinel.
const contentFrame = (text) => `data: ${JSON.stringify({
  id: "chatcmpl-5902-usage",
  model: "glm-5.2",
  created: 1,
  choices: [{ index: 0, delta: { content: text }, finish_reason: "" }],
})}\n\n`;
const usageFrame = `data: ${JSON.stringify({ choices: [], usage })}\n\n`;
const doneFrame = "data: [DONE]\n\n";

/** Parse the JSON data frames of an SSE stream. */
const frames = (wire) => {
  const reader = createSseFrameReader();
  return [...reader.push(wire), ...reader.flush()]
    .filter((frame) => frame.data.trim() && frame.data.trim() !== "[DONE]")
    .map((frame) => JSON.parse(frame.data));
};

async function upstreamResponse(...parts) {
  const encoder = new TextEncoder();
  globalThis.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } }));
  const { response } = await new CodeBuddyExecutor().execute({
    model: "glm-5.2",
    body: { messages: [] },
    stream: true,
    credentials: { accessToken: "cb-test-token" },
  });
  return response;
}

const forcedJson = async (providerResponse) => handleForcedSSEToJson({
  providerResponse,
  sourceFormat: FORMATS.OPENAI,
  targetFormat: FORMATS.OPENAI,
  provider: "codebuddy-cn",
  model: "glm-5.2",
  body: { model: "glm-5.2", messages: [{ role: "user", content: "hi" }] },
  stream: false,
  translatedBody: null,
  finalBody: null,
  requestStartTime: Date.now(),
  connectionId: "c",
  apiKey: null,
  clientRawRequest: { endpoint: "/v1/chat/completions" },
  log: { line: vi.fn(), debug: vi.fn() },
  usageEventId: "e",
  trackDone: vi.fn(),
  appendLog: vi.fn(),
  onRequestSuccess: vi.fn(async () => {}),
  terminalProvenance: "upstream",
});

describe("9router #5902 review finding: CodeBuddy usage-only frame", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("holds the usage-only frame until the terminal chunk exists", async () => {
    const response = await upstreamResponse(contentFrame("hello"), usageFrame, doneFrame);
    const output = await response.text();
    const chunks = frames(output);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices[0].delta.content).toBe("hello");
    expect(chunks[1].choices[0].finish_reason).toBe("stop");
    expect(chunks[1].usage).toEqual(usage);
    // Usage reaches the client exactly once, on the finish chunk.
    expect(output.match(/"usage"/g)).toHaveLength(1);
    expect(output.match(/\[DONE\]/g)).toHaveLength(1);
  });

  it("answers a forced SSE-to-JSON client with the content, one stop and one usage", async () => {
    const response = await upstreamResponse(contentFrame("hello"), usageFrame, doneFrame);
    const result = await forcedJson(response);
    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    const json = await result.response.json();
    expect(json.choices[0].message.content).toBe("hello");
    expect(json.choices[0].finish_reason).toBe("stop");
    expect(json.usage).toEqual(usage);
  });

  it("streams one coherent terminal and reports the terminal to the caller", async () => {
    const response = await upstreamResponse(contentFrame("hello"), usageFrame, doneFrame);
    const onCoherentTerminal = vi.fn();
    const output = await new Response(response.body.pipeThrough(createSSEStream({
      mode: "passthrough",
      targetFormat: FORMATS.OPENAI,
      sourceFormat: FORMATS.OPENAI,
      provider: "codebuddy-cn",
      model: "glm-5.2",
      body: { model: "glm-5.2", messages: [{ role: "user", content: "hi" }] },
      onCoherentTerminal,
    }))).text();
    const chunks = frames(output);
    expect(chunks[0].choices[0].delta.content).toBe("hello");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
    expect(chunks.filter((chunk) => chunk.usage)).toHaveLength(1);
    expect(onCoherentTerminal).toHaveBeenCalledTimes(1);
  });

  it("keeps an upstream usage frame when the turn already carried its own finish", async () => {
    const finished = `data: ${JSON.stringify({
      id: "chatcmpl-5902-usage",
      model: "glm-5.2",
      created: 1,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`;
    const response = await upstreamResponse(contentFrame("hello"), finished, usageFrame, doneFrame);
    const chunks = frames(await response.text());
    expect(chunks.map((chunk) => chunk.choices?.[0]?.finish_reason)).toEqual([null, "stop", undefined]);
    expect(chunks.at(-1)).toEqual({ choices: [], usage });
  });

  it("keeps the upstream order when an error interrupts the turn", async () => {
    const response = await upstreamResponse(
      contentFrame("hello"),
      usageFrame,
      `data: ${JSON.stringify({ error: { message: "upstream failed" } })}\n\n`,
      doneFrame,
    );
    const chunks = frames(await response.text());
    expect(chunks).toHaveLength(3);
    expect(chunks[1]).toEqual({ choices: [], usage });
    expect(chunks[2]).toEqual({ error: { message: "upstream failed" } });
  });
});
