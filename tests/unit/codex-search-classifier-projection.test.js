import { describe, expect, it, vi } from "vitest";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const search = { type: "web_search_20250305", name: "web_search" };
const output = [
  { type: "reasoning", summary: [{ type: "summary_text", text: "private reasoning" }] },
  { id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", query: "find it", sources: [{ url: "https://example.test", title: "Example" }] } },
  { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "<block>no</block>", annotations: [{ type: "url_citation", url: "https://example.test", title: "Example" }] }] },
];

async function request(mode, bodyOverrides = {}) {
  const events = [
    { type: "response.created", response: { id: "resp_1" } },
    ...output.map((item, output_index) => ({ type: "response.output_item.done", output_index, item })),
    { type: "response.completed", response: { id: "resp_1", status: "completed", output, usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } },
  ];
  const payload = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const result = await handleForcedSSEToJson({
    providerResponse: new Response(payload, { headers: { "content-type": "text/event-stream" } }),
    provider: "codex", model: "requested", sourceFormat: FORMATS.CLAUDE,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    body: { model: "requested", messages: [{ role: "user", content: "find it" }], tools: [search], stream: false, ...bodyOverrides },
    stream: false, requestStartTime: Date.now(), clientRawRequest: { endpoint: "/v1/messages" },
    trackDone: vi.fn(), appendLog: vi.fn(), claudeClassifierCompat: mode,
  });
  expect(result.success).toBe(true);
  return result.response.json();
}

describe("buffered Codex search classifier projection", () => {
  it.each([
    ["always", {}],
    ["auto", { stop_sequences: ["</block>"] }],
    ["auto", { system: [{ type: "text", text: "You are a security monitor for autonomous AI coding agents" }] }],
  ])("keeps the compatibility projection for %s", async (mode, body) => {
    const result = await request(mode, body);
    expect(result.content).toEqual([{ type: "text", text: "<block>no</block>" }]);
    expect(result.usage).toMatchObject({ input_tokens: 10, output_tokens: 3 });
  });

  it.each(["off", "auto"])("preserves search evidence for ordinary requests with %s", async mode => {
    const result = await request(mode);
    expect(result.content.map(block => block.type)).toEqual(["thinking", "server_tool_use", "web_search_tool_result", "text"]);
    expect(result.content[2].content[0].url).toBe("https://example.test");
    expect(result.usage).toMatchObject({ input_tokens: 10, output_tokens: 3, server_tool_use: { web_search_requests: 1 } });
  });
});
