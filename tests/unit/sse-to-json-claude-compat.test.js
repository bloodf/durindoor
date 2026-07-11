// Seam-B (#2254): handleForcedSSEToJson threads claudeClassifierCompat into
// Claude-shaped projections so the classifier's allow/deny decision is the only
// visible content. Verifies shouldEnableClaudeCompat gating (off/auto/always)
// and that the projector suppresses the reasoning `thinking` block only when
// claudeCompat is enabled.
import { describe, expect, it, vi } from "vitest";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const SECURITY_MARKER = "You are a security monitor for autonomous AI coding agents";

function claudeBody({ systemText, stopSequences } = {}) {
  const body = { model: "claude-test", messages: [{ role: "user", content: "hi" }] };
  if (systemText) body.system = [{ type: "text", text: systemText }];
  if (stopSequences) body.stop_sequences = stopSequences;
  return body;
}

function sseResponse(chunks) {
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}`).join("\n") + "\ndata: [DONE]\n";
  return {
    headers: new Map([["content-type", "text/event-stream"]]),
    text: () => Promise.resolve(lines),
    status: 200,
  };
}

const STREAM_WITH_THINKING = [
  { id: "chatcmpl-x", object: "chat.completion.chunk", created: 1, model: "upstream-m", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "secret chain" }, finish_reason: null }] },
  { id: "chatcmpl-x", object: "chat.completion.chunk", created: 1, model: "upstream-m", choices: [{ index: 0, delta: { content: "ALLOW" }, finish_reason: "stop" }] },
  { id: "chatcmpl-x", object: "chat.completion.chunk", created: 1, model: "upstream-m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
];

function baseOpts(overrides = {}) {
  return {
    provider: "galadriel",
    model: "claude-test",
    sourceFormat: FORMATS.CLAUDE,
    targetFormat: FORMATS.CLAUDE,
    body: claudeBody(),
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "conn-1",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/messages" },
    onRequestSuccess: vi.fn(() => Promise.resolve()),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    toolNameMap: null,
    reqTag: "t",
    log: null,
    providerResponse: sseResponse(STREAM_WITH_THINKING),
    ...overrides,
  };
}

async function project(opts) {
  const result = await handleForcedSSEToJson(opts);
  expect(result).not.toBeNull();
  const json = JSON.parse(await result.response.text());
  return json;
}

const types = (json) => (json.content || []).map((p) => p.type);

describe("handleForcedSSEToJson claudeClassifierCompat", () => {
  it("off: preserves the thinking block for a Claude SSE projection", async () => {
    const json = await project(baseOpts({ claudeClassifierCompat: "off", body: claudeBody({ systemText: SECURITY_MARKER }) }));
    expect(types(json)).toContain("thinking");
    expect(types(json)).toContain("text");
  });

  it("always: suppresses the thinking block", async () => {
    const json = await project(baseOpts({ claudeClassifierCompat: "always" }));
    expect(types(json)).not.toContain("thinking");
    expect(types(json)).toContain("text");
  });

  it("auto + security-monitor system marker: suppresses thinking", async () => {
    const json = await project(baseOpts({ claudeClassifierCompat: "auto", body: claudeBody({ systemText: SECURITY_MARKER }) }));
    expect(types(json)).not.toContain("thinking");
  });

  it("auto + </block> stop_sequence: suppresses thinking", async () => {
    const json = await project(baseOpts({ claudeClassifierCompat: "auto", body: claudeBody({ stopSequences: ["</block>"] }) }));
    expect(types(json)).not.toContain("thinking");
  });

  it("auto without markers: preserves thinking", async () => {
    const json = await project(baseOpts({ claudeClassifierCompat: "auto", body: claudeBody() }));
    expect(types(json)).toContain("thinking");
  });

  it("undefined claudeClassifierCompat (older caller): defaults to off, preserves thinking", async () => {
    const opts = baseOpts();
    delete opts.claudeClassifierCompat;
    const json = await project(opts);
    expect(types(json)).toContain("thinking");
  });

  it("non-Claude sourceFormat is unaffected even when compat is always", async () => {
    const json = await project(baseOpts({ sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI, claudeClassifierCompat: "always" }));
    // OpenAI passthrough: Claude-only compat gate must not alter other formats.
    // The pre-projection strip still drops reasoning_content when content is
    // present for non-Claude sources; the response shape stays chat.completion.
    expect(json.object).toBe("chat.completion");
    expect(json.choices?.[0]?.message?.content).toBe("ALLOW");
    expect(json.choices?.[0]?.message?.reasoning_content).toBeUndefined();
  });
});
