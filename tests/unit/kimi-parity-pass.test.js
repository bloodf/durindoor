import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
import { refreshKimiToken } from "open-sse/services/tokenRefresh/providers.js";
import { __clearRefreshDedupCacheForTesting } from "open-sse/services/tokenRefresh/dedup.js";
import { __setOriginalFetchForTesting } from "open-sse/utils/proxyFetch.js";

let restoreFetch;
afterEach(() => {
  restoreFetch?.();
  __clearRefreshDedupCacheForTesting();
  vi.restoreAllMocks();
});

describe.each(["kimi-coding", "kimi-ai"])("%s refresh parity", (provider) => {
  it.each(["invalid_grant", "invalid_request"])("classifies %s as permanent", async (code) => {
    restoreFetch = __setOriginalFetchForTesting(vi.fn(async () => Response.json({ error: code }, { status: 400 })));
    expect(await refreshKimiToken(provider, { refreshToken: `token-${code}` })).toEqual({
      error: "unrecoverable_refresh_error", code,
    });
  });

  it.each([
    { access_token: " " },
    { access_token: 42 },
    { access_token: "valid", refresh_token: " " },
    { access_token: "valid", refresh_token: {} },
  ])("rejects malformed successful credentials %#", async (tokens) => {
    restoreFetch = __setOriginalFetchForTesting(vi.fn(async () => Response.json(tokens)));
    expect(await refreshKimiToken(provider, { refreshToken: "old-token" })).toBeNull();
  });

  it("retains the old refresh token when rotation is omitted", async () => {
    restoreFetch = __setOriginalFetchForTesting(vi.fn(async () => Response.json({ access_token: "new" })));
    expect(await refreshKimiToken(provider, { refreshToken: "old-token" })).toMatchObject({
      accessToken: "new", refreshToken: "old-token",
    });
  });
});

import { getExecutor } from "open-sse/executors/index.js";
import { initTranslators } from "open-sse/translator/index.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";

describe.each(["kimi-coding", "kimi-ai", "kimi-coding-apikey"])("%s OpenAI request", (provider) => {
  it("retains tool names and requests usage in the streaming wire envelope", () => {
    const body = {
      max_tokens: 25,
      stream_options: { custom: true, include_usage: false },
      messages: [
        { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "read" } }] },
        { role: "tool", tool_call_id: "call-1", content: "ok" },
        { role: "tool", tool_call_id: "other", content: "unknown" },
        { role: "tool", tool_call_id: "call-1", name: "existing", content: "kept" },
      ],
    };
    const result = getExecutor(provider).transformRequest("k3", body, true, {
      runtimeTransport: { format: "openai" },
    });
    expect(result).toMatchObject({ max_completion_tokens: 25, stream_options: { custom: true, include_usage: true } });
    expect(result).not.toHaveProperty("max_tokens");
    expect(result.messages[1].name).toBe("read");
    expect(result.messages[2]).not.toHaveProperty("name");
    expect(result.messages[3].name).toBe("existing");
  });
});

describe("Kimi Web unsupported tools", () => {
  it.each(["tools", "functions"])("rejects %s before contacting upstream", async (field) => {
    const outbound = vi.fn(() => { throw new Error("unexpected network request"); });
    restoreFetch = __setOriginalFetchForTesting(outbound);
    const result = await getExecutor("kimi-web").execute({
      model: "k2d6", body: { model: "k2d6", messages: [{ role: "user", content: "hi" }], [field]: [{}] },
      credentials: { apiKey: "kimi-auth=eyJ.test" }, stream: false,
    });
    expect(result.response.status).toBe(400);
    expect(await result.response.text()).toContain("does not support");
    expect(outbound).not.toHaveBeenCalled();
  });
});

it("sends the repaired regional OpenAI request through chat core", async () => {
  await initTranslators();
  const outbound = vi.fn(async (_url, options) => {
    const wire = JSON.parse(options.body);
    expect(wire.max_completion_tokens).toBe(30);
    expect(wire.messages.find((message) => message.role === "tool").name).toBe("read");
    return Response.json({ id: "test", object: "chat.completion", model: "k3",
      choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  restoreFetch = __setOriginalFetchForTesting(outbound);
  const body = { model: "kimi-ai/k3", max_tokens: 30, messages: [
    { role: "assistant", tool_calls: [{ id: "call-1", type: "function", function: { name: "read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call-1", content: "ok" },
  ] };
  const result = await handleChatCore({ body, modelInfo: { provider: "kimi-ai", model: "k3" },
    credentials: { accessToken: "fake", providerSpecificData: { oauthProxy: { mode: "direct" } } },
    sourceFormatOverride: "openai", clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    connectionId: "test", log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() } });
  expect(result.success).toBe(true);
  expect(outbound).toHaveBeenCalledTimes(1);
});
