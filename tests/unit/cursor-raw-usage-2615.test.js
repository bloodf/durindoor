import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const db = vi.hoisted(() => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/usageDb.js", () => db);
const { CursorExecutor } = await import("../../open-sse/executors/cursor.js");
const { encodeField, wrapConnectRPCFrame } = await import("../../open-sse/utils/cursorProtobuf.js");
const { estimateUsage } = await import("../../open-sse/utils/usageTracking.js");
const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const body = { messages: [{ role: "user", content: "A Cursor request" }] };
const frame = Buffer.from(wrapConnectRPCFrame(encodeField(2, 2, encodeField(1, 2, "Hello Cursor"))));
const raw = () => estimateUsage(body, "Hello Cursor".length, "openai", { buffer: false });
let original;
beforeEach(() => { original = process.env.USAGE_BUFFER_TOKENS; process.env.USAGE_BUFFER_TOKENS = "123"; vi.clearAllMocks(); });
afterEach(() => { if (original === undefined) delete process.env.USAGE_BUFFER_TOKENS; else process.env.USAGE_BUFFER_TOKENS = original; });

it("records the Cursor buffered estimate raw and adds one client margin", async () => {
  const providerResponse = new CursorExecutor().transformProtobufToJSON(frame, "model", body);
  const result = await handleNonStreamingResponse({
    providerResponse, provider: "cursor", model: "model", sourceFormat: "openai", targetFormat: "openai", body,
    requestStartTime: Date.now(), connectionId: "c", clientRawRequest: {}, trackDone: vi.fn(), appendLog: vi.fn(),
    reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
  });
  expect(db.saveRequestUsage.mock.calls[0][0].tokens).toMatchObject(raw());
  const client = (await result.response.json()).usage;
  expect(client.prompt_tokens).toBe(raw().prompt_tokens + 123);
  expect(client.total_tokens).toBe(raw().total_tokens + 123);
});

it("records the Cursor stream estimate raw and adds one client margin", async () => {
  const response = new CursorExecutor().transformProtobufToSSE(frame, "model", body);
  let recorded;
  const text = await new Response(response.body.pipeThrough(createPassthroughStreamWithLogger(
    "cursor", null, null, "model", "c", body, (_content, usage) => { recorded = usage; },
  ))).text();
  const client = text.split("\n").filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6))).find((event) => event.usage).usage;
  expect(recorded).toMatchObject(raw());
  expect(client.prompt_tokens).toBe(raw().prompt_tokens + 123);
  expect(client.total_tokens).toBe(raw().total_tokens + 123);
});
