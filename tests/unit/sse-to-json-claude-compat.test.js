// Seam-B (#2254): handleForcedSSEToJson threads claudeClassifierCompat into
// Claude-shaped projections so the classifier's allow/deny decision is the only
// visible content. Verifies shouldEnableClaudeCompat gating (off/auto/always)
// and that the projector suppresses the reasoning `thinking` block only when
// claudeCompat is enabled.
import { describe, expect, it, vi } from "vitest";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { REASONING_HEADER } from "../../open-sse/config/runtimeConfig.js";

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
  { id: "chatcmpl-x", object: "chat.completion.chunk", created: 1, model: "upstream-m", choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
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

  it("keeps reasoning_content by default and strips it only on forced-SSE opt-out", async () => {
    const openAIOptions = {
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      claudeClassifierCompat: "always",
    };
    const kept = await project(baseOpts(openAIOptions));
    const stripped = await project(baseOpts({
      ...openAIOptions,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        headers: { [REASONING_HEADER]: "off" },
      },
    }));

    expect(kept.object).toBe("chat.completion");
    expect(kept.choices?.[0]?.message).toMatchObject({
      content: "ALLOW",
      reasoning_content: "secret chain",
    });
    expect(stripped.choices?.[0]?.message).not.toHaveProperty("reasoning_content");
  });
});
