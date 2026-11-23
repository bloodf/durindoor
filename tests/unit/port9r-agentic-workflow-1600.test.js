import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRequestDetail: vi.fn(),
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: mocks.saveRequestDetail,
  saveRequestUsage: mocks.saveRequestUsage,
  appendRequestLog: mocks.appendRequestLog,
}));

import { buildOnStreamComplete } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

const cache = { type: "ephemeral" };
const toolUse = { type: "tool_use", id: "tu_1", name: "read", input: {} };
const toolResult = { type: "tool_result", tool_use_id: "tu_1", content: "ok", cache_control: cache };

function toolList(count) {
  return Array.from({ length: count }, (_, index) => ({ name: `tool_${index}` }));
}

describe("developer instruction turns", () => {
  it("folds a developer turn into the next user turn and keeps cache markers and tool results", () => {
    const body = {
      system: [{ type: "text", text: "stable", cache_control: cache }],
      messages: [
        { role: "user", content: [{ type: "text", text: "read it" }] },
        { role: "assistant", content: [toolUse] },
        { role: "user", content: [toolResult] },
        { role: "developer", content: [{ type: "text", text: "be brief", cache_control: cache }] },
        { role: "user", content: [{ type: "text", text: "followup" }] },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, { foldSystemTurns: true });

    expect(body.system).toEqual([{ type: "text", text: "stable", cache_control: cache }]);
    expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "user"]);
    expect(body.messages[1]).toEqual({ role: "assistant", content: [toolUse] });
    expect(body.messages[2]).toEqual({ role: "user", content: [toolResult] });
    expect(body.messages[3]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "followup" },
        { type: "text", text: "be brief", cache_control: cache },
      ],
    });
  });

  it("appends a developer turn after tool results instead of an assistant tool call", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "read it" }] },
        { role: "developer", content: [{ type: "text", text: "be brief", cache_control: cache }] },
        { role: "assistant", content: [toolUse] },
        { role: "user", content: [toolResult] },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, { foldSystemTurns: true });

    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "read it" }] },
      { role: "assistant", content: [toolUse] },
      {
        role: "user",
        content: [
          toolResult,
          { type: "text", text: "be brief", cache_control: cache },
        ],
      },
    ]);
  });

  it("drops a trailing developer turn without rewriting earlier turns", () => {
    const earlier = [
      { role: "user", content: [{ type: "text", text: "ask" }] },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ];
    const body = {
      messages: [
        ...earlier,
        { role: "developer", content: [{ type: "text", text: "late", cache_control: cache }] },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, {
      foldSystemTurns: true,
      rawHeaders: { "x-9router-assistant-prefill": "preserve" },
    });

    expect(body.messages).toEqual(earlier);
    expect(body.system).toBeUndefined();
  });

  it("hoists developer text onto system and leaves tool turns in order", () => {
    const body = {
      system: "primary",
      messages: [
        { role: "user", content: [{ type: "text", text: "ask" }] },
        {
          role: "developer",
          content: [
            { type: "text", text: "dev instruction", cache_control: cache },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } },
          ],
        },
        { role: "assistant", content: [toolUse] },
        { role: "user", content: [toolResult] },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null);

    expect(body.system).toEqual([
      { type: "text", text: "primary" },
      { type: "text", text: "dev instruction", cache_control: cache },
    ]);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "ask" }] },
      { role: "assistant", content: [toolUse] },
      { role: "user", content: [toolResult] },
    ]);
  });
});

describe("measured low-output diagnostic", () => {
  const ctx = {
    provider: "deepseek",
    model: "deepseek-chat",
    connectionId: "connection-12345678",
    apiKey: "client-key",
    requestStartTime: Date.now() - 1000,
    stream: true,
    finalBody: null,
    translatedBody: null,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    reqTag: "T1",
    log: null,
    usageEventId: "usage-low",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveRequestDetail.mockResolvedValue(undefined);
    mocks.saveRequestUsage.mockResolvedValue(undefined);
    mocks.appendRequestLog.mockResolvedValue(undefined);
  });

  function warningsFrom(run) {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    run();
    const messages = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
    return messages.filter((message) => message.includes("[EMPTY-RESPONSE]"));
  }

  function complete(toolCount, usage) {
    return warningsFrom(() => {
      buildOnStreamComplete({ ...ctx, body: { tools: toolList(toolCount) } })
        .onStreamComplete({ content: "short" }, usage, null, {});
    });
  }

  it("warns on a completed stream with measured low output and five or more tools", () => {
    expect(complete(5, { completion_tokens: 12 })).toEqual([
      "[WARN] [EMPTY-RESPONSE] deepseek | deepseek-chat | out=12 tok but 5 tools sent — provider may not handle large tool lists. Remove this provider from tool-heavy combos.",
    ]);
    expect(complete(5, { output_tokens: 49 })).toHaveLength(1);
  });

  it("ignores missing usage, a measured zero, enough output, and a short tool list", () => {
    expect(complete(5, null)).toEqual([]);
    expect(complete(5, { prompt_tokens: 20 })).toEqual([]);
    expect(complete(5, { completion_tokens: 0 })).toEqual([]);
    expect(complete(5, { completion_tokens: 50 })).toEqual([]);
    expect(complete(4, { completion_tokens: 12 })).toEqual([]);
  });

  it("does not warn when the stream is cancelled, even with a low measured snapshot", () => {
    const warnings = warningsFrom(() => {
      const built = buildOnStreamComplete({ ...ctx, body: { tools: toolList(5) } });
      built.onStreamAbandoned("client_disconnected", {
        usage: { completion_tokens: 12 },
        content: "partial",
      });
    });
    expect(warnings).toEqual([]);
  });

  it("warns once when completion wins the race with cancellation", () => {
    const warnings = warningsFrom(() => {
      const built = buildOnStreamComplete({ ...ctx, body: { tools: toolList(5) } });
      built.onStreamComplete({ content: "short" }, { completion_tokens: 12 }, null, {});
      built.onStreamAbandoned("client_disconnected", { usage: { completion_tokens: 12 } });
    });
    expect(warnings).toHaveLength(1);
  });
});
