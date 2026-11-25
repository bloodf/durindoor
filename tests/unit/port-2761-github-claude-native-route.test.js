/**
 * Upstream decolua/9router#2761: a Claude-source request to a GitHub Copilot
 * Claude model must stay Claude-shaped. Pivoting through OpenAI dropped the
 * assistant turn's signed thinking block.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../translator/registerAll.js";
import { handleChatCore, resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";

const { proxyAwareFetch } = vi.hoisted(() => {
  // Nothing in this file may reach a real host.
  vi.stubGlobal("fetch", async (url) => { throw new Error(`unexpected fetch: ${url}`); });
  return { proxyAwareFetch: vi.fn() };
});
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch,
}));

const SIGNATURE = "EpwGCkYIChgCKkCzVUuRrg7CcglSUWEef4rH6o35g9UYS8ZPe0/VomQTBsFx6sttYNj5";
const MODEL = "claude-sonnet-4.6";
const credentials = { accessToken: "tok" };

function claudeBody() {
  return {
    model: MODEL,
    max_tokens: 2048,
    stream: false,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    context_management: { edits: [{ type: "clear_thinking_20251015" }] },
    metadata: { user_id: "u1" },
    tools: [{ name: "get_weather", description: "w", input_schema: { type: "object", properties: {} } }],
    messages: [
      { role: "user", content: "weather?" },
      { role: "assistant", content: [
        { type: "thinking", thinking: "I should call the weather tool.", signature: SIGNATURE },
        { type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "Beijing" } },
      ] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "sunny" }] },
    ],
  };
}

const resolve = (provider, model, sourceFormat) =>
  resolveRequestTransport({ provider, alias: provider === "github" ? "gh" : "ghe", model, sourceFormat, credentials }).targetFormat;

async function dispatch(model, { upstreamBodyFormat = FORMATS.CLAUDE, body = claudeBody(), response } = {}) {
  proxyAwareFetch.mockResolvedValueOnce(response || Response.json({ type: "message", content: [] }));
  const result = await new GithubExecutor().execute({
    model, body, stream: false, credentials, signal: null, log: null,
    requestContext: { upstreamBodyFormat },
  });
  const [url, options] = proxyAwareFetch.mock.calls.at(-1);
  return { result, url, headers: options.headers, sent: JSON.parse(options.body) };
}

describe("port 9router #2761: GitHub Copilot Claude native route", () => {
  beforeEach(() => proxyAwareFetch.mockReset());

  it("targets Claude only for Claude-source Claude models", () => {
    for (const provider of ["github", "ghe-copilot"]) {
      expect(resolve(provider, MODEL, FORMATS.CLAUDE)).toBe(FORMATS.CLAUDE);
      // Live-catalog ids the static list does not have are matched by name.
      expect(resolve(provider, "claude-opus-9", FORMATS.CLAUDE)).toBe(FORMATS.CLAUDE);
      expect(resolve(provider, MODEL, FORMATS.OPENAI)).toBe(FORMATS.OPENAI);
      expect(resolve(provider, "gpt-5.4", FORMATS.CLAUDE)).toBe(FORMATS.OPENAI);
    }
  });

  it("sends the signed thinking block to /v1/messages and returns the upstream response unchanged", async () => {
    const translated = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, MODEL, claudeBody(), false, {}, "github");
    const snapshot = structuredClone(translated);
    const upstream = Response.json({ type: "message", content: [{ type: "text", text: "ok" }] });

    const { result, url, headers, sent } = await dispatch(MODEL, { body: translated, response: upstream });

    expect(url).toBe("https://api.githubcopilot.com/v1/messages");
    const thinking = sent.messages[1].content[0];
    expect(thinking).toMatchObject({ type: "thinking", signature: SIGNATURE });
    expect(sent.thinking?.type).toBe("adaptive");
    // Client stream preference is kept, so no SSE conversion is needed.
    expect(sent.stream).toBe(false);
    expect(headers.Accept).toBe("application/json");
    expect(result.response).toBe(upstream);
    expect(result.terminalProvenance).toBe("upstream");
    // The caller's body survives for a retry after token refresh.
    expect(translated).toEqual(snapshot);
  });

  it("carries the signature from a Claude client through chatCore and answers in Claude shape", async () => {
    proxyAwareFetch.mockResolvedValueOnce(Response.json({
      id: "msg_1", type: "message", role: "assistant", model: MODEL, stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "done", signature: SIGNATURE }, { type: "text", text: "sunny" }],
      usage: { input_tokens: 5, output_tokens: 2 },
    }));
    const body = claudeBody();

    const result = await handleChatCore({
      body,
      modelInfo: { provider: "github", model: MODEL },
      credentials: { accessToken: "tok", providerSpecificData: {} },
      connectionId: "port-2761",
      sourceFormatOverride: FORMATS.CLAUDE,
      clientRawRequest: { endpoint: "/v1/messages", body, headers: { accept: "application/json" } },
    });

    const [url, options] = proxyAwareFetch.mock.calls.at(-1);
    expect(url).toBe("https://api.githubcopilot.com/v1/messages");
    const assistant = JSON.parse(options.body).messages.find((message) => message.role === "assistant");
    expect(assistant.content[0]).toMatchObject({ type: "thinking", signature: SIGNATURE });
    const answer = await result.response.json();
    expect(answer.type).toBe("message");
    expect(answer.content[0]).toMatchObject({ type: "thinking", signature: SIGNATURE });
  });

  it("passes a Claude event stream through without an OpenAI conversion", async () => {
    const sse = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    const upstream = new Response(sse, { headers: { "content-type": "text/event-stream" } });
    const { result } = await dispatch(MODEL, { response: upstream });
    expect(await result.response.text()).toBe(sse);
  });

  it("keeps beta-only client fields off the Copilot wire", async () => {
    const { sent } = await dispatch(MODEL);
    expect(sent).not.toHaveProperty("context_management");
    expect(sent).not.toHaveProperty("metadata");
  });

  it("keeps the Copilot reasoning policy for models that reject it", async () => {
    const { sent } = await dispatch("claude-haiku-4.5", { body: { ...claudeBody(), temperature: 0.5 } });
    expect(sent).not.toHaveProperty("thinking");
    expect(sent).not.toHaveProperty("temperature");
    expect(sent.output_config?.effort).toBeUndefined();
  });

  it("marks a Claude tool continuation as agent-initiated, and a new user turn as user", async () => {
    const continuation = await dispatch(MODEL);
    expect(continuation.headers["X-Initiator"]).toBe("agent");

    const body = claudeBody();
    body.messages.at(-1).content.push({ type: "text", text: "and tomorrow?" });
    const followUp = await dispatch(MODEL, { body });
    expect(followUp.headers["X-Initiator"]).toBe("user");
  });
});
