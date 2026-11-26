import "../translator/registerAll.js";
import { describe, expect, it, vi } from "vitest";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { stripAllThinkingForSignatureRecovery } from "../../open-sse/handlers/chatCore/thinkingSignatureRecovery.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

// Well-formed but foreign: passes DurinDoor's structural signature filter, which
// already drops malformed ones, and is rejected only by the upstream.
const FOREIGN = Buffer.from([0x12, 0x04, 0x0a, 0x02, 0x08, 0x01]).toString("base64");
const OLD = Buffer.from([0x12, 0x04, 0x0a, 0x02, 0x08, 0x02]).toString("base64");

const activeCycle = () => [
  { role: "user", content: [{ type: "text", text: "run" }] },
  { role: "assistant", content: [
    { type: "thinking", thinking: "x", signature: FOREIGN },
    { type: "tool_use", id: "toolu_1", name: "Bash", input: {} },
  ] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
];

const signatureError = () => new Response(JSON.stringify({ type: "error", error: {
  type: "invalid_request_error", message: "messages.1.content.0: Invalid `signature` in `thinking` block",
} }), { status: 400, headers: { "Content-Type": "application/json" } });

const success = () => new Response(JSON.stringify({
  id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5",
  content: [{ type: "text", text: "done" }], stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
}), { status: 200, headers: { "Content-Type": "application/json" } });

const blockTypes = (body) => body.messages.flatMap((m) => Array.isArray(m.content) ? m.content.map((c) => c.type) : []);

async function run(messages, respond) {
  const sent = [];
  const executorOverride = {
    noAuth: true,
    refreshCredentials: async () => null,
    execute: async ({ body }) => {
      sent.push(structuredClone(body));
      return { response: respond(body), url: "https://upstream.invalid/v1/messages", headers: {}, transformedBody: body };
    },
  };
  const body = { model: "claude-sonnet-5-5", max_tokens: 4096, stream: false, thinking: { type: "enabled", budget_tokens: 1024 }, messages };
  const result = await handleChatCore({
    body,
    modelInfo: { provider: "claude", model: "claude-sonnet-5-5" },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    clientRawRequest: { endpoint: "/v1/messages", body, headers: {} },
    sourceFormatOverride: "claude",
    executorOverride,
  });
  return { sent, result };
}

describe("OmniRoute #20063 - escalate thinking-signature recovery on foreign-signed tool cycles", () => {
  it("retries a foreign-signed active tool cycle with thinking off and the tool pair intact", async () => {
    const { sent, result } = await run(activeCycle(), (body) =>
      blockTypes(body).includes("thinking") ? signatureError() : success());

    expect(result.success).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toHaveProperty("thinking");
    expect(blockTypes(sent[1])).toEqual(expect.arrayContaining(["tool_use", "tool_result"]));
    expect(blockTypes(sent[1])).not.toContain("thinking");
  });

  it("tries the conservative strip first, escalates once, then stops", async () => {
    const history = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "old", signature: OLD }, { type: "text", text: "a" }] },
      ...activeCycle(),
    ];
    const { sent, result } = await run(history, signatureError);

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(sent).toHaveLength(3);
    expect(blockTypes(sent[1]).filter((type) => type === "thinking")).toHaveLength(1);
    expect(sent[1]).toHaveProperty("thinking");
    expect(blockTypes(sent[2])).not.toContain("thinking");
    expect(sent[2]).not.toHaveProperty("thinking");
  });

  it("drops only clear_thinking edits and never mutates the input", () => {
    const body = {
      thinking: { type: "adaptive" },
      context_management: { edits: [{ type: "clear_thinking_20251015" }, { type: "clear_tool_uses_20250919" }] },
      messages: activeCycle(),
    };
    const snapshot = structuredClone(body);
    expect(stripAllThinkingForSignatureRecovery(body).context_management).toEqual({ edits: [{ type: "clear_tool_uses_20250919" }] });
    expect(body).toEqual(snapshot);
    expect(stripAllThinkingForSignatureRecovery({ ...body, context_management: { edits: [{ type: "clear_thinking_20251015" }] } }))
      .not.toHaveProperty("context_management");
  });

  it("keeps opaque redacted_thinking untouched", () => {
    const body = { messages: [...activeCycle(), { role: "assistant", content: [{ type: "redacted_thinking", data: "opaque" }] }] };
    expect(stripAllThinkingForSignatureRecovery(body)).toBe(body);
  });
});
