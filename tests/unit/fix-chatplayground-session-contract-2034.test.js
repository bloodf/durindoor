import { describe, it, expect, vi } from "vitest";
import { acquireChatPlaygroundSession, inspectChatPlaygroundConnection } from "../../open-sse/executors/chatplaygroundSession.js";
import { ChatPlaygroundExecutor } from "../../open-sse/executors/chatplayground.js";
const jwt = (data) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(data)).toString("base64url")}.signature`;
const cookie = (id) => `__client=client-${id}; __session=${jwt({ sid: `sid-${id}` })}`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

describe("selected ChatPlayground sessions #2034", () => {
  it("isolates account/proxy snapshots and refreshes every operation", async () => {
    const calls = [];
    for (const account of ["a", "b", "a"]) {
      const proxy = `https://proxy-${account}.invalid`;
      const transport = async (url, init) => {
        calls.push({ url, init, proxy });
        expect(init.redirect).toBe("manual");
        expect(init.credentials).toBe("omit");
        if (url.includes("clerk.")) {
          expect(init.headers.cookie).toBe(`__client=client-${account}`);
          return json({ jwt: jwt({ exp: Math.floor(Date.now() / 1000) + 30, sub: account }) });
        }
        expect(init.headers.cookie).toBeUndefined();
        if (url.endsWith("/me")) {
          expect(init.headers.Authorization).toContain("Bearer eyJ");
          return json({ id: account });
        }
        expect(init.headers.Authorization).toBeUndefined();
        return json({ data: [] });
      };
      expect(await inspectChatPlaygroundConnection({ apiKey: cookie(account) }, transport, { discovery: true })).toMatchObject({ ok: true, catalog: { data: [] } });
    }
    expect(calls).toHaveLength(9);
    expect(calls.map(c => c.proxy)).toEqual(["a", "a", "a", "b", "b", "b", "a", "a", "a"].map(a => `https://proxy-${a}.invalid`));
  });
  it("bounds expiry and refuses expired tokens without a downstream send", async () => {
    const fetcher = vi.fn(async () => json({ jwt: jwt({ exp: 1 }) }));
    expect(await inspectChatPlaygroundConnection({ apiKey: cookie("a") }, fetcher)).toMatchObject({ ok: false, reason: "session_expired" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const result = await acquireChatPlaygroundSession(cookie("a"), async () => json({ jwt: "opaque-token" }));
    expect(result.expiresAt - Date.now()).toBeLessThanOrEqual(60000);
  });
  it.each([301, 403, 429])("refuses mint status %s without echo or fallback", async (status) => {
    const fetcher = vi.fn(async () => new Response(cookie("a"), { status, headers: { location: "https://evil.invalid/?secret=client-a" } }));
    const result = await inspectChatPlaygroundConnection({ apiKey: cookie("a") }, fetcher);
    expect(result).toMatchObject({ ok: false, status });
    expect(JSON.stringify(result)).not.toMatch(/client-a|evil|__session/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["echo", "html", "large", "unknown"]) ("fails closed on %s", async (kind) => {
    const fetcher = vi.fn(async (url) => {
      if (url.includes("clerk.")) {
        if (kind === "echo") return json({ jwt: cookie("a") });
        if (kind === "html") return new Response("<html>challenge</html>", { headers: { "content-type": "text/html" } });
        if (kind === "large") return new Response("x".repeat(262145));
        return json({ jwt: "opaque-token" });
      }
      return json({ message: "success" });
    });
    expect(await inspectChatPlaygroundConnection({ apiKey: cookie("a") }, fetcher)).toMatchObject({ ok: false });
    expect(fetcher.mock.calls.every(([url]) => url.startsWith("https://clerk.chatplayground.ai/") || url === "https://web.chatplayground.ai/api/me")).toBe(true);
  });
  it("bounds a stalled body and prevents late dispatch after deadline", async () => {
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start() {} })));
    expect(await inspectChatPlaygroundConnection({ apiKey: cookie("a") }, fetcher, { timeoutMs: 10 })).toMatchObject({ ok: false, status: 408 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    const unsent = vi.fn();
    expect(await inspectChatPlaygroundConnection({}, unsent, { signal: controller.signal })).toMatchObject({ status: 408 });
    expect(unsent).not.toHaveBeenCalled();
  });
  it("settles pre-aborted acquisition and readiness without unhandled rejection", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    const options = { signal: controller.signal };
    await expect(acquireChatPlaygroundSession(cookie("a"), fetcher, options)).resolves.toMatchObject({ status: 408 });
    await expect(inspectChatPlaygroundConnection({ apiKey: cookie("a") }, fetcher, options)).resolves.toMatchObject({ status: 408 });
    // Vitest reports unhandled rejections after the promise has ostensibly settled.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["../x", "a/b", "a?b", ""])("refuses session id %j before any dispatch", async (sid) => {
    const fetcher = vi.fn();
    const raw = `__client=client-a; __session=${jwt({ sid })}`;
    expect(await inspectChatPlaygroundConnection({ apiKey: raw }, fetcher)).toMatchObject({ ok: false, status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses a /me redirect without following it or reaching another origin", async () => {
    const fetcher = vi.fn(async (url) => url.includes("clerk.")
      ? json({ jwt: "opaque-token" })
      : new Response(null, { status: 302, headers: { location: "https://evil.invalid/collect" } }));
    const result = await inspectChatPlaygroundConnection({ apiKey: cookie("a") }, fetcher, { discovery: true });
    expect(result).toMatchObject({ ok: false, status: 302 });
    expect(JSON.stringify(result)).not.toMatch(/evil|client-a|opaque-token/);
    expect(fetcher.mock.calls.map(([url]) => url.split("?")[0])).toEqual([
      "https://clerk.chatplayground.ai/v1/client/sessions/sid-a/tokens", "https://web.chatplayground.ai/api/me",
    ]);
  });
  it("requires a selected-connection transport instead of ambient fetch", async () => {
    const ambient = vi.fn();
    vi.stubGlobal("fetch", ambient);
    try {
      expect(await inspectChatPlaygroundConnection({ apiKey: cookie("a") })).toMatchObject({ ok: false, reason: "selected_connection_transport_required" });
      expect(ambient).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("does not redispatch chat after unknown work", async () => {
    const fetcher = vi.fn(async (url) => {
      if (url.includes("clerk.")) return json({ jwt: "opaque-token" });
      if (url.endsWith("/me")) return json({ id: "a" });
      if (url.endsWith("/models")) return json({ data: [{ slug: "test" }] });
      throw new Error("unknown dispatch");
    });
    await expect(new ChatPlaygroundExecutor(fetcher).execute({ model: "test", body: {}, credentials: { apiKey: cookie("a") } })).rejects.toThrow();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/chat"))).toHaveLength(1);
  });
});
