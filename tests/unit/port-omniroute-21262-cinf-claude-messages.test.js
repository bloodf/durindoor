// OmniRoute #21262 (0b39f717b1c9): Cheaper Inference Claude models use the
// gateway's native /v1/messages route, so cache_control breakpoints survive.
import net from "node:net";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const MESSAGES_URL = "https://api.cheaperinference.com/v1/messages";
const upstream = vi.hoisted(() => ({ calls: [] }));

const syntheticUpstream = vi.hoisted(() => async (url, init = {}) => {
  if (!String(url).startsWith("https://api.cheaperinference.com/")) throw new Error(`unexpected URL: ${url}`);
  upstream.calls.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
  return Response.json({
    id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4.6",
    content: [{ type: "text", text: "pong" }], stop_reason: "end_turn",
    choices: String(url).endsWith("/chat/completions")
      ? [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }] : undefined,
    usage: { input_tokens: 3, output_tokens: 1 },
  });
});

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: vi.fn(syntheticUpstream),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), saveRequestUsage: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

vi.stubGlobal("fetch", vi.fn(syntheticUpstream));
const dial = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => {
  throw new Error("network dial blocked in test");
});
afterAll(() => {
  dial.mockRestore();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  upstream.calls.length = 0;
});

async function send(body, endpoint) {
  const result = await handleChatCore({
    body,
    modelInfo: { provider: "cheaperinference", model: body.model },
    credentials: { apiKey: "test-key", connectionId: "cinf-test" },
    clientRawRequest: { endpoint, body, headers: {} },
    connectionId: "cinf-test",
  });
  expect(result.success, result.error).toBe(true);
  expect(upstream.calls).toHaveLength(1);
  expect(dial).not.toHaveBeenCalled();
  return upstream.calls[0];
}

describe("OmniRoute #21262: Cheaper Inference Claude native Messages", () => {
  it("keeps Claude cache_control breakpoints and drops the billing line", async () => {
    const sent = await send({
      model: "claude-sonnet-4.6",
      max_tokens: 64,
      stream: false,
      system: [
        { type: "text", text: "x-anthropic-billing-header: cc_version=1; cch=abc;" },
        { type: "text", text: "Stable instructions.", cache_control: { type: "ephemeral" } },
      ],
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: [{ type: "text", text: "earlier reply", cache_control: { type: "ephemeral" } }] },
        { role: "user", content: "ping" },
      ],
    }, "/v1/messages");

    expect(sent.url).toBe(MESSAGES_URL);
    expect(sent.headers.get("authorization")).toBe("Bearer test-key");
    expect(sent.headers.get("x-api-key")).toBeNull();
    expect(sent.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(JSON.stringify(sent.body.system)).not.toContain("x-anthropic-billing-header");
    expect(sent.body.system.at(-1)).toMatchObject({ text: "Stable instructions.", cache_control: { type: "ephemeral" } });
    expect(sent.body.messages[1].content.at(-1).cache_control).toMatchObject({ type: "ephemeral" });
    expect(sent.body).not.toHaveProperty("store");
  });

  it("sends an OpenAI Chat client to the same Messages route", async () => {
    const sent = await send({
      model: "claude-haiku-4.5",
      stream: false,
      messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "ping" }],
    }, "/v1/chat/completions");

    expect(sent.url).toBe(MESSAGES_URL);
    expect(sent.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(JSON.stringify(sent.body.system)).toContain("Be brief.");
    expect(JSON.stringify(sent.body.system)).not.toContain("Claude Code");
  });

  it("keeps a non-Claude model from a Claude client on Chat Completions", async () => {
    const sent = await send({
      model: "glm-5.2", max_tokens: 64, stream: false,
      messages: [{ role: "user", content: "ping" }],
    }, "/v1/messages");

    expect(sent.url).toBe("https://api.cheaperinference.com/v1/chat/completions");
    expect(sent.headers.get("anthropic-version")).toBeNull();
  });
});
