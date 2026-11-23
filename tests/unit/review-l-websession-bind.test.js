import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: fetchMock }));

import { storeChatGptImage, getChatGptImageConversationContext, __resetChatGptImageCacheForTesting } from "../../open-sse/services/chatgptImageCache.js";
import { ClaudeWebExecutor } from "../../open-sse/executors/claude-web.js";
import { NotionWebExecutor } from "../../open-sse/executors/notion-web.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const claudeStream = new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
const claudeInput = (apiKeyId) => ({ apiKeyId, connectionId: "shared-connection", model: "claude-sonnet-4-6", body: { messages: [{ role: "user", content: "hello" }] }, credentials: { apiKey: "sessionKey=shared-cookie", connectionId: "shared-connection" } });
const notionInput = (apiKeyId) => ({ apiKeyId, connectionId: "shared-connection", body: { model: "notion-ai", messages: [{ role: "user", content: "hello" }] }, credentials: { apiKey: "token_v2=shared-cookie; space_id=space; notion_user_id=user", connectionId: "shared-connection" }, clientHeaders: { "x-notion-thread-id": "client-thread" } });

afterEach(() => { fetchMock.mockReset(); __resetChatGptImageCacheForTesting(); });

describe("web-session conversation ownership", () => {
  it("only exposes cached ChatGPT continuation context to its API key and connection", () => {
    const context = { conversationId: "conversation-a", parentMessageId: "parent-a", owner: { apiKeyId: "key-a", connectionId: "connection-a" } };
    const id = storeChatGptImage(Buffer.from("image"), "image/png", 60_000, context);
    expect(getChatGptImageConversationContext(id, "key-a", "connection-a")).toEqual(context);
    expect(getChatGptImageConversationContext(id, "key-b", "connection-a")).toBeNull();
    expect(getChatGptImageConversationContext(id, "key-a", "connection-b")).toBeNull();
    expect(getChatGptImageConversationContext(id)).toBeNull();
  });

  it("scopes Claude Web staged conversations to API key and connection", async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith("/organizations")
      ? json([{ uuid: "org" }])
      : claudeStream.clone());
    const executor = new ClaudeWebExecutor();
    await executor.execute(claudeInput("key-a"));
    await executor.execute(claudeInput("key-a"));
    await executor.execute(claudeInput("key-b"));
    const conversationIds = fetchMock.mock.calls.filter(([url]) => String(url).includes("chat_conversations/")).map(([url]) => String(url).match(/chat_conversations\/([^/]+)\//)[1]);
    expect(conversationIds[1]).toBe(conversationIds[0]);
    expect(conversationIds[2]).not.toBe(conversationIds[0]);
  });

  it("scopes Notion Web staged threads to API key and connection, including supplied thread ids", async () => {
    fetchMock.mockImplementation(async (url) => String(url).includes("getAvailableModels")
      ? json({ models: [] })
      : new Response('{"value":{"text":"ok"}}\n'));
    const executor = new NotionWebExecutor();
    await executor.execute(notionInput("key-a"));
    await executor.execute(notionInput("key-a"));
    await executor.execute(notionInput("key-b"));
    const threadIds = fetchMock.mock.calls.filter(([url]) => String(url).includes("runInferenceTranscript")).map(([, init]) => JSON.parse(init.body).threadId);
    expect(threadIds[1]).toBe(threadIds[0]);
    expect(threadIds[2]).not.toBe(threadIds[0]);
  });
});
