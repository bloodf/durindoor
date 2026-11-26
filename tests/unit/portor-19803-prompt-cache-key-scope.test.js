import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { DefaultExecutor, injectPromptCacheKey } from "../../open-sse/executors/default.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const PROVIDER = "openai-compatible-chat-test";
const credentials = (extra) => ({
  connectionId: "account-a",
  _clientSessionId: "claude:session-a",
  _cachePrincipalId: "key-a",
  providerSpecificData: { enablePromptCacheKey: true },
  ...extra,
});
const keyFor = (extra, { provider = PROVIDER, model = "model-a" } = {}) =>
  injectPromptCacheKey(provider, { model, messages: [] }, credentials(extra), model).prompt_cache_key;

describe("OmniRoute #19803 — prompt cache key scope", () => {
  it("is stable for one gateway key, connection, model and session", () => {
    expect(keyFor()).toMatch(/^cc_[a-f0-9]{32}$/);
    expect(keyFor()).toBe(keyFor());
  });

  it.each([
    ["gateway API key", { _cachePrincipalId: "key-b" }, {}],
    ["upstream connection", { connectionId: "account-b" }, {}],
    ["session", { _clientSessionId: "claude:session-b" }, {}],
    ["model", {}, { model: "model-b" }],
    ["provider", {}, { provider: "openai-compatible-chat-other" }],
  ])("differs for another %s", (_label, extra, route) => {
    expect(keyFor(extra, route)).not.toBe(keyFor());
  });

  it("keeps a caller's explicit key", () => {
    const body = { model: "model-a", prompt_cache_key: "client-key" };
    expect(injectPromptCacheKey(PROVIDER, body, credentials(), "model-a").prompt_cache_key).toBe("client-key");
  });

  it("does not expose the gateway key id or session in the hint", () => {
    expect(keyFor()).not.toContain("key-a");
    expect(keyFor()).not.toContain("session-a");
  });

  // Only transports with preservePromptCacheKey forward the hint, so this uses `openai`.
  it("reaches the wire scoped by the executor's model and principal", async () => {
    const live = vi.fn(async () => { throw new Error("offline test reached global fetch"); });
    vi.stubGlobal("fetch", live);
    const send = async (_cachePrincipalId) => {
      const fetcher = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
      await new DefaultExecutor("openai").execute({
        model: "model-a",
        body: { model: "model-a", messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: credentials({ apiKey: "mock", _cachePrincipalId }),
        directFetch: fetcher,
      });
      expect(fetcher).toHaveBeenCalledOnce();
      return JSON.parse(fetcher.mock.calls[0][1].body).prompt_cache_key;
    };
    const first = await send("key-a");
    expect(first).toBe(keyFor(undefined, { provider: "openai" }));
    expect(await send("key-b")).not.toBe(first);
    expect(live).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each([
    [{ apiKeyId: "id-a", apiKey: "sk-a" }, "id-a"],
    [{ apiKey: "sk-env" }, "sk-env"],
    [{}, undefined],
  ])("chat core hands the executor the caller identity for %j", async (caller, expected) => {
    let seen;
    const callerCredentials = { accessToken: "fixture" };
    await handleChatCore({
      ...caller,
      body: { model: "model-a", stream: false, messages: [{ role: "user", content: "hi" }] },
      modelInfo: { provider: PROVIDER, model: "model-a" },
      credentials: callerCredentials,
      executorOverride: {
        noAuth: true,
        execute: async (args) => {
          seen = args.credentials._cachePrincipalId;
          return { response: Response.json({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), url: "https://example.invalid", headers: {}, transformedBody: args.body };
        },
      },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(seen).toBe(expected);
    expect(callerCredentials).toEqual({ accessToken: "fixture" });
  });
});
