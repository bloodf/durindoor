import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const db = vi.hoisted(() => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/usageDb.js", () => db);
const { CursorExecutor } = await import("../../open-sse/executors/cursor.js");
const { encodeField, wrapConnectRPCFrame } = await import("../../open-sse/utils/cursorProtobuf.js");
const { estimateUsage } = await import("../../open-sse/utils/usageTracking.js");
const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const body = { messages: [{ role: "user", content: "A Cursor request" }] };
const frame = Buffer.from(wrapConnectRPCFrame(encodeField(2, 2, encodeField(1, 2, "Hello Cursor"))));
const raw = () => estimateUsage(body, "Hello Cursor".length, "openai", { buffer: false });
let original;
beforeEach(() => { original = process.env.USAGE_BUFFER_TOKENS; process.env.USAGE_BUFFER_TOKENS = "123"; vi.clearAllMocks(); });
afterEach(() => { if (original === undefined) delete process.env.USAGE_BUFFER_TOKENS; else process.env.USAGE_BUFFER_TOKENS = original; });

async function nonStream(sourceFormat) {
  const providerResponse = new CursorExecutor().transformProtobufToJSON(frame, "model", body);
  const result = await handleNonStreamingResponse({
    providerResponse, provider: "cursor", model: "model", sourceFormat, targetFormat: "openai", body,
    requestStartTime: Date.now(), connectionId: "c", clientRawRequest: {}, trackDone: vi.fn(), appendLog: vi.fn(),
    reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
  });
  return { recorded: db.saveRequestUsage.mock.calls[0]?.[0]?.tokens, client: (await result.response.json()).usage };
}

async function stream(sourceFormat) {
  const response = new CursorExecutor().transformProtobufToSSE(frame, "model", body);
  let recorded;
  const text = await new Response(response.body.pipeThrough(createSSETransformStreamWithLogger(
    "openai", sourceFormat, "cursor", null, null, "model", "c", body, (_content, usage) => { recorded = usage; },
  ))).text();
  const events = text.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
  const client = events.map((event) => event.usage || event.response?.usage).filter(Boolean).at(-1);
  return { recorded, client, events };
}

it.each([
  ["claude", "non-streaming", nonStream],
  ["claude", "streaming", stream],
  ["openai-responses", "non-streaming", nonStream],
  ["openai-responses", "streaming", stream],
])("%s %s: records raw Cursor usage and projects one client margin", async (sourceFormat, _mode, run) => {
  const { recorded, client } = await run(sourceFormat);
  expect(recorded.prompt_tokens ?? recorded.input_tokens).toBe(raw().prompt_tokens);
  expect(client.input_tokens).toBe(raw().prompt_tokens + 123);
});

it("Responses streaming keeps the margin on total_tokens exactly once", async () => {
  const { client } = await stream("openai-responses");
  expect(client.total_tokens).toBe(raw().total_tokens + 123);
});

// Provider-reported usage on these two routes is projected as before (no margin).
const reported = { prompt_tokens: 15, completion_tokens: 3, total_tokens: 18 };
const chatJson = () => new Response(JSON.stringify({
  id: "x", object: "chat.completion", created: 1, model: "m",
  choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }], usage: reported,
}), { headers: { "Content-Type": "application/json" } });
const chatSse = () => new Response([
  { id: "x", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "Hello" } }] },
  { id: "x", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: reported },
].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });

it("Claude non-streaming leaves provider-reported usage unpadded", async () => {
  const result = await handleNonStreamingResponse({
    providerResponse: chatJson(), provider: "openai", model: "m", sourceFormat: "claude", targetFormat: "openai", body,
    requestStartTime: Date.now(), connectionId: "c", clientRawRequest: {}, trackDone: vi.fn(), appendLog: vi.fn(),
    reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
  });
  expect((await result.response.json()).usage.input_tokens).toBe(15);
});

it("Responses streaming leaves provider-reported usage unpadded", async () => {
  const text = await new Response(chatSse().body.pipeThrough(createSSETransformStreamWithLogger(
    "openai", "openai-responses", "openai", null, null, "m", "c", body, () => {},
  ))).text();
  const usage = text.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)))
    .map((event) => event.response?.usage).filter(Boolean).at(-1);
  expect(usage.input_tokens).toBe(15);
});
