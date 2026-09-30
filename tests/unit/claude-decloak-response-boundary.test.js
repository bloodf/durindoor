/**
 * Response-boundary regression: a legitimate client tool named `run_ide` must
 * survive the real streaming/non-streaming handlers unless the request was
 * actually cloaked (explicit claudeCloaked context). Cloaked requests whose
 * toolNameMap was lost still get the suffix stripped; a map hit always wins.
 */
import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const common = () => ({
  provider: "claude",
  model: "claude-opus-4",
  sourceFormat: FORMATS.CLAUDE,
  targetFormat: FORMATS.CLAUDE,
  body: { model: "claude-opus-4", messages: [{ role: "user", content: "hi" }] },
  translatedBody: { model: "claude-opus-4", messages: [{ role: "user", content: "hi" }] },
  finalBody: null,
  requestStartTime: Date.now(),
  connectionId: "conn",
  apiKey: null,
  clientRawRequest: null,
  trackDone: vi.fn(),
  appendLog: vi.fn(),
  reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
  reqTag: "",
  log: {},
  usageEventId: "usage-event",
  claudeClassifierCompat: "off",
  terminalProvenance: "upstream",
});

async function nonStreaming(name, extra) {
  const message = {
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-4",
    content: [{ type: "tool_use", id: "toolu_1", name, input: {} }],
    stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 },
  };
  const result = await handleNonStreamingResponse({
    ...common(),
    stream: false,
    streamToClient: false,
    providerResponse: new Response(JSON.stringify(message), { headers: { "content-type": "application/json" } }),
    ...extra,
  });
  expect(result.success).toBe(true);
  return (await result.response.json()).content[0].name;
}

async function streaming(name, extra) {
  const frames = [
    { type: "message_start", message: { id: "msg_1", usage: { input_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name, input: {} } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  const sse = frames.map((f) => `event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`).join("");
  const result = await handleStreamingResponse({
    ...common(),
    stream: true,
    providerResponse: new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    streamController: { handleError: vi.fn(), startTime: Date.now(), isConnected: () => true, handleComplete: () => {} },
    ...extra,
  });
  expect(result.success).toBe(true);
  const text = await result.response.text();
  return /"name":"([^"]+)"/.exec(text)[1];
}

describe("_ide tool-name decloak at the response boundary", () => {
  it("non-streaming: keeps a legitimate run_ide tool when the request was not cloaked", async () => {
    expect(await nonStreaming("run_ide", { toolNameMap: null })).toBe("run_ide");
    expect(await nonStreaming("run_ide", { toolNameMap: null, claudeCloaked: false })).toBe("run_ide");
  });

  it("streaming: keeps a legitimate run_ide tool when the request was not cloaked", async () => {
    expect(await streaming("run_ide", { toolNameMap: null })).toBe("run_ide");
    expect(await streaming("run_ide", { toolNameMap: null, claudeCloaked: false })).toBe("run_ide");
  });

  it("non-streaming: cloaked OAuth request with lost map still strips the suffix", async () => {
    expect(await nonStreaming("run_ide", { toolNameMap: null, claudeCloaked: true })).toBe("run");
  });

  it("streaming: cloaked OAuth request with lost map still strips the suffix", async () => {
    expect(await streaming("run_ide", { toolNameMap: null, claudeCloaked: true })).toBe("run");
  });

  it("map hit wins over stripping when cloaked", async () => {
    const map = new Map([["run_ide", "run_ide"]]);
    expect(await nonStreaming("run_ide", { toolNameMap: map, claudeCloaked: true })).toBe("run_ide");
    expect(await streaming("run_ide", { toolNameMap: map, claudeCloaked: true })).toBe("run_ide");
  });
});

describe("_claudeCloaked request marker (production translateRequest gate)", () => {
  const req = () => ({ model: "claude-opus-4", max_tokens: 10, messages: [{ role: "user", content: "hi" }], tools: [{ name: "run", description: "d", input_schema: { type: "object", properties: {} } }] });
  const translate = (credentials) => translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-opus-4", req(), true, credentials, "claude");

  it("is set for an OAuth token request that was actually cloaked", () => {
    const out = translate({ accessToken: "sk-ant-oat-test" });
    expect(out._claudeCloaked).toBe(true);
    expect(out.tools.some((t) => t.name === "run_ide")).toBe(true);
  });

  it("is absent for an API-key request (no cloaking applied)", () => {
    const out = translate({ apiKey: "sk-ant-api-test" });
    expect(out._claudeCloaked).toBeUndefined();
    expect(out.tools.some((t) => t.name === "run")).toBe(true);
  });
});
