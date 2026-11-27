import { describe, it, expect, vi, beforeEach } from "vitest";

const wire = vi.hoisted(() => ({ send: vi.fn(), billed: vi.fn() }));
vi.mock("../../open-sse/executors/sendRequest.js", () => ({
  createExecutorSender: () => ({ sendRequest: wire.send }),
  withBillableDispatch: (_sender, run) => run((response) => { wire.billed(); return response; }),
  isRefusedRedirect: (error) => /unexpected redirect/i.test(error.message),
  requestAbortError: () => new DOMException("aborted", "AbortError"),
}));
import provider, { discoverV0Models } from "../../open-sse/providers/private/v0-vercel-web.js";
import { V0VercelWebExecutor, V0_CHAT_URL, v0SessionCookie } from "../../open-sse/executors/v0-vercel-web.js";

const execute = (apiKey, stream = false) => new V0VercelWebExecutor().execute({ credentials: { apiKey }, body: { model: "v0-default", messages: [{ role: "user", content: "hello", extra: true }], extra: true }, stream });
beforeEach(() => { wire.send.mockReset(); wire.billed.mockReset(); });

describe("staged v0 web session", () => {
  it("exposes scoped static discovery without capture claims", () => {
    expect(provider.id).toBe("v0-vercel-web");
    expect(discoverV0Models()).toEqual(provider.models);
    expect(provider.cookieImport).toBeUndefined(); expect(provider.webLogin).toBeUndefined();
  });
  it("rejects missing, malformed, ambiguous and injected credentials before sending", async () => {
    for (const value of [undefined, "", "other=x", "__vercel_session=", "__vercel_session=a; __vercel_session=b", "a\r\nX: b"]) {
      expect((await execute(value)).response.status).toBe(401);
    }
    expect(wire.send).not.toHaveBeenCalled();
    expect(v0SessionCookie("bad")).toBeNull();
  });
  it("sends the selected account only to the fixed endpoint and maps JSON usage", async () => {
    wire.send.mockResolvedValue(Response.json({ content: "answer", reasoning_content: "reason", usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    const result = await execute("other=x; __vercel_session=account-a");
    const [url, init] = wire.send.mock.calls[0];
    expect(url).toBe(V0_CHAT_URL); expect(init.redirect).toBe("manual");
    expect(init.headers.Cookie).toBe("__vercel_session=account-a");
    expect(JSON.parse(init.body)).toEqual({ messages: [{ role: "user", content: "hello" }], model: "v0-default", stream: false });
    expect(await result.response.json()).toMatchObject({ choices: [{ message: { content: "answer", reasoning_content: "reason" } }], usage: { total_tokens: 3 } });
    expect(result.headers.Cookie).toBe("[REDACTED]"); expect(wire.billed).toHaveBeenCalledTimes(1);
    await execute("account-b"); expect(wire.send.mock.calls[1][1].headers.Cookie).toBe("__vercel_session=account-b");
  });
  it("preserves SSE terminal, error and usage events", async () => {
    const events = 'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":3}}\n\ndata: {"error":{"message":"failed"}}\n\ndata: [DONE]\n\n';
    wire.send.mockResolvedValue(new Response(events, { headers: { "content-type": "text/event-stream" } }));
    const result = await execute("session", true);
    expect(await result.response.text()).toBe(events); expect(wire.billed).toHaveBeenCalledTimes(1);
  });
  it("maps expiry, redirects, error envelopes and malformed responses", async () => {
    for (const response of [new Response(null, { status: 302, headers: { location: "https://evil.invalid" } }), new Response(null, { status: 401 }), new Response(null, { status: 403 })]) {
      wire.send.mockResolvedValueOnce(response); expect((await execute("session")).response.status).toBe(401);
    }
    wire.send.mockRejectedValueOnce(new Error("unexpected redirect")); expect((await execute("session")).response.status).toBe(401);
    wire.send.mockResolvedValueOnce(Response.json({ error: { status: 429 } })); expect((await execute("session")).response.status).toBe(429);
    wire.send.mockResolvedValueOnce(new Response("bad")); expect((await execute("session")).response.status).toBe(502);
    expect(wire.send.mock.calls.every(([url, init]) => url === V0_CHAT_URL && init.redirect === "manual")).toBe(true);
  });
});
