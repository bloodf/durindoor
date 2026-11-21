import { afterEach, describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import entry, { claudeWebCookieProfile } from "../../open-sse/providers/private/claude-web.js";
import { normalizeClaudeWebCookie } from "../../open-sse/executors/claude-web.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: fetchMock }));
vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { default: privateEntry } = await import("../../open-sse/providers/private/claude-web.js");
  return { ...original, default: [...original.default, privateEntry] };
});
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { ClaudeWebExecutor } = await import("../../open-sse/executors/claude-web.js");
  const claude = new ClaudeWebExecutor();
  return { ...original, getExecutor: (provider) => provider === "claude-web" || provider === "cw" ? claude : original.getExecutor(provider) };
});
import { getExecutor } from "../../open-sse/executors/index.js";

const COOKIE_A = "sessionKey=synthetic-session-a";
const COOKIE_B = "sessionKey=synthetic-session-b";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const stream = (events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const orgs = json([{ uuid: "org-synthetic" }]);
const chatBody = (streaming = false) => ({ model: "claude-sonnet-4-6", stream: streaming, messages: [{ role: "user", content: "hello" }] });

describe("Claude Web private provider profile", () => {
  it("defines the cookie capture contract and model catalog", () => {
    expect(entry).toMatchObject({ id: "claude-web", alias: "cw", category: "webCookie", authType: "cookie" });
    expect(entry.models.map((model) => model.id)).toContain("claude-sonnet-4-6");
    expect(PROVIDERS["claude-web"].executor).toBe("claude-web");
    expect(PROVIDER_MODELS["cw"].map((model) => model.id)).toContain("claude-sonnet-4-6");
    expect(claudeWebCookieProfile).toMatchObject({ domains: ["claude.ai"], cookieNames: ["sessionKey"], validationProbe: { method: "GET" } });
    expect(normalizeClaudeWebCookie(COOKIE_A)).toBe(COOKIE_A);
    expect(normalizeClaudeWebCookie("sessionKey=")).toBe("");
    expect(REGISTRY.some((provider) => provider.id === "claude-web")).toBe(true);
  });
});

describe("Claude Web executor", () => {
  afterEach(() => vi.clearAllMocks());
  const executor = getExecutor("claude-web");

  it("validates usable and rejected sessions", async () => {
    fetchMock.mockResolvedValueOnce(json([{ uuid: "org-synthetic" }])).mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({}, 401));
    expect(await executor.testConnection({ apiKey: COOKIE_A })).toBe(true);
    expect(await executor.testConnection({ apiKey: "not-a-cookie" })).toBe(false);
    const bad = await executor.execute({ model: "claude-sonnet-4-6", body: chatBody(), stream: false, credentials: { apiKey: COOKIE_A } });
    expect(bad.response.status).toBe(401);
  });

  it("discovers the organization and returns JSON chat completions", async () => {
    fetchMock.mockResolvedValueOnce(json([{ uuid: "org-synthetic" }])).mockResolvedValueOnce(stream([
      { type: "content_block_delta", delta: { type: "text_delta", text: "hello back" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]));
    const result = await executor.execute({ model: "claude-sonnet-4-6", body: chatBody(false), stream: false, credentials: { apiKey: COOKIE_A, connectionId: "a" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("/organizations/org-synthetic/chat_conversations/");
    expect(fetchMock.mock.calls[1][1].headers.Cookie).toBe(COOKIE_A);
    expect((await result.response.json()).choices[0].message.content).toBe("hello back");
  });

  it("converts Claude event streams to OpenAI chunks", async () => {
    fetchMock.mockResolvedValueOnce(json([{ uuid: "org-synthetic" }])).mockResolvedValueOnce(stream([
      { type: "content_block_delta", delta: { type: "text_delta", text: "chunk" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]));
    const result = await executor.execute({ model: "claude-sonnet-4-6", body: chatBody(true), stream: true, credentials: { apiKey: COOKIE_A, connectionId: "stream" } });
    const body = await result.response.text();
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain('"content":"chunk"');
    expect(body).toContain("data: [DONE]");
  });

  it("maps expired sessions and quota responses and isolates cookies", async () => {
    fetchMock.mockResolvedValueOnce(json([{ uuid: "org-synthetic" }])).mockResolvedValueOnce(json({ error: "expired" }, 403));
    expect((await executor.execute({ model: "claude-sonnet-4-6", body: chatBody(), credentials: { apiKey: COOKIE_A } })).response.status).toBe(401);
    fetchMock.mockResolvedValueOnce(json([{ uuid: "org-synthetic" }])).mockResolvedValueOnce(json({ error: "quota" }, 429));
    expect((await executor.execute({ model: "claude-sonnet-4-6", body: chatBody(), credentials: { apiKey: COOKIE_B } })).response.status).toBe(429);
    fetchMock.mockResolvedValueOnce(json([{ uuid: "org-synthetic" }])).mockResolvedValueOnce(stream([{ type: "content_block_delta", delta: { type: "text_delta", text: "ok" } }]));
    await executor.execute({ model: "claude-sonnet-4-6", body: chatBody(), credentials: { apiKey: COOKIE_B, connectionId: "b" } });
    expect(fetchMock.mock.calls.at(-1)[1].headers.Cookie).toBe(COOKIE_B);
    expect(fetchMock.mock.calls.at(-1)[1].headers.Cookie).not.toContain(COOKIE_A);
  });
});
