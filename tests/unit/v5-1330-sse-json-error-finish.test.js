// #1330 / #1089 (Option A): Chat Completions SSE→JSON with finish_reason "error"
// must fail like the non-stream coherence gate — 502, no markSuccess — for
// Claude and Gemini clients. Do not project end_turn / STOP / OTHER as success.
import { describe, expect, it, vi } from "vitest";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_FINISH } from "../../open-sse/translator/schema/finishReasons.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";
import { INCOHERENT_NON_STREAMING_RESPONSE_MESSAGE } from "../../open-sse/config/errorConfig.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  saveUsageStats: vi.fn(() => Promise.resolve()),
  extractRequestConfig: vi.fn(() => ({})),
  buildRequestDetail: vi.fn((args) => args),
  formatDoneLine: vi.fn(() => "📊 done"),
}));

function errorFinishSSE({ content = "partial" } = {}) {
  const chunks = [
    {
      id: "chatcmpl-1330",
      object: "chat.completion.chunk",
      created: 1,
      model: "upstream-m",
      choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
    },
    {
      id: "chatcmpl-1330",
      object: "chat.completion.chunk",
      created: 1,
      model: "upstream-m",
      choices: [{ index: 0, delta: {}, finish_reason: OPENAI_FINISH.ERROR }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}`).join("\n") + "\ndata: [DONE]\n";
  return {
    headers: new Map([["content-type", "text/event-stream"]]),
    text: () => Promise.resolve(lines),
    status: 200,
  };
}

function stopFinishSSE({ content = "ok" } = {}) {
  const chunks = [
    {
      id: "chatcmpl-1330-ok",
      object: "chat.completion.chunk",
      created: 1,
      model: "upstream-m",
      choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
    },
    {
      id: "chatcmpl-1330-ok",
      object: "chat.completion.chunk",
      created: 1,
      model: "upstream-m",
      choices: [{ index: 0, delta: {}, finish_reason: OPENAI_FINISH.STOP }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}`).join("\n") + "\ndata: [DONE]\n";
  return {
    headers: new Map([["content-type", "text/event-stream"]]),
    text: () => Promise.resolve(lines),
    status: 200,
  };
}

function baseOpts({ sourceFormat, providerResponse }) {
  const onRequestSuccess = vi.fn(() => Promise.resolve());
  const trackDone = vi.fn();
  const appendLog = vi.fn();
  return {
    provider: "openai",
    model: "upstream-m",
    sourceFormat,
    targetFormat: FORMATS.OPENAI,
    body: { model: "upstream-m", messages: [{ role: "user", content: "hi" }] },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "conn-1330",
    apiKey: null,
    clientRawRequest: { endpoint: sourceFormat === FORMATS.CLAUDE ? "/v1/messages" : "/v1/chat/completions" },
    onRequestSuccess,
    trackDone,
    appendLog,
    toolNameMap: null,
    reqTag: "t-1330",
    log: null,
    usageEventId: "evt-1330",
    claudeClassifierCompat: "off",
    terminalProvenance: "upstream",
    providerResponse,
  };
}

describe("#1330 SSE→JSON error finish → 502 (Claude + Gemini clients)", () => {
  it.each([
    ["Claude", FORMATS.CLAUDE],
    ["Gemini", FORMATS.GEMINI],
  ])("%s client: finish_reason error returns 502 and does not markSuccess", async (_label, sourceFormat) => {
    const opts = baseOpts({ sourceFormat, providerResponse: errorFinishSSE() });
    const result = await handleForcedSSEToJson(opts);

    expect(result.success).toBe(false);
    expect(result.status).toBe(HTTP_STATUS.BAD_GATEWAY);
    expect(result.error).toBe(INCOHERENT_NON_STREAMING_RESPONSE_MESSAGE);
    expect(result.response.status).toBe(HTTP_STATUS.BAD_GATEWAY);
    expect(opts.onRequestSuccess).not.toHaveBeenCalled();
    expect(opts.trackDone).toHaveBeenCalledOnce();
    expect(opts.appendLog).toHaveBeenCalledWith({
      status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}`,
    });
  });

  it.each([
    ["Claude", FORMATS.CLAUDE],
    ["Gemini", FORMATS.GEMINI],
  ])("%s client: finish_reason stop still succeeds", async (_label, sourceFormat) => {
    const opts = baseOpts({ sourceFormat, providerResponse: stopFinishSSE() });
    const result = await handleForcedSSEToJson(opts);

    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    expect(opts.onRequestSuccess).toHaveBeenCalledOnce();
    expect(opts.trackDone).toHaveBeenCalledOnce();
  });
});
