import { afterEach, describe, expect, it, vi } from "vitest";
import { TwinmindExecutor } from "../../open-sse/executors/twinmind.js";
const jwt = (name) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: name, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.synthetic`;
const input = (key) => ({ model: "auto", body: { model: "auto", messages: [{ role: "user", content: "ping" }] }, credentials: { apiKey: key }, connectionId: key, stream: false });
const events = () => new Response('data: {"type":"text_start","content":"hel"}\n\ndata: {"type":"text_delta","content":"lo"}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("TwinMind dispatch", () => {
  it("refreshes once, reuses the token, and isolates connections", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const issued = { one: jwt("one"), two: jwt("two") };
    const seen = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      expect(init.redirect).toBe("manual");
      if (new URL(url).host === "securetoken.googleapis.com") {
        const refresh = new URLSearchParams(init.body).get("refresh_token");
        seen.push(`refresh:${refresh}`);
        vi.setSystemTime(Date.now() + 1000);
        return Response.json({ id_token: issued[refresh], refresh_token: refresh, expires_in: "3600" });
      }
      expect(url).toBe("https://api2.twinmind.com/api/v3/chat");
      expect(JSON.parse(init.body)).toMatchObject({ type: "app", mode: "private", model: { model_name: "gpt-5.6-sol-thinking" } });
      seen.push(new Headers(init.headers).get("authorization"));
      return events();
    }));
    const executor = new TwinmindExecutor();
    for (const key of ["one", "one", "two"]) expect((await (await executor.execute(input(key))).response.json()).choices[0].message.content).toBe("hello");
    expect(seen.filter((item) => item.startsWith("refresh:"))).toEqual(["refresh:one", "refresh:two"]);
    expect(seen.filter((item) => item.startsWith("Bearer "))).toEqual([
      `Bearer ${issued.one}`, `Bearer ${issued.one}`, `Bearer ${issued.two}`,
    ]);
  });
  it("shares a pending refresh only for the same connection and credentials", async () => {
    const refreshGate = Promise.withResolvers();
    const tokens = [jwt("first"), jwt("second"), jwt("changed")];
    const refreshes = [];
    const bearers = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (new URL(url).host === "securetoken.googleapis.com") {
        const token = tokens[refreshes.length] ?? jwt("unexpected");
        const refresh = new URLSearchParams(init.body).get("refresh_token");
        refreshes.push(refresh);
        await refreshGate.promise;
        return Response.json({ id_token: token, refresh_token: refresh });
      }
      expect(url).toBe("https://api2.twinmind.com/api/v3/chat");
      bearers.push(new Headers(init.headers).get("authorization"));
      return events();
    }));
    const executor = new TwinmindExecutor();
    const first = input("shared");
    const second = { ...first, connectionId: "second" };
    const changed = { ...first, credentials: { ...first.credentials, refreshToken: "changed" } };
    const requests = [first, first, second, changed].map((request) => executor.execute(request));
    refreshGate.resolve();
    expect((await Promise.all(requests)).map(({ response }) => response.status)).toEqual([200, 200, 200, 200]);
    expect(refreshes).toEqual(["shared", "shared", "changed"]);
    expect(bearers.sort()).toEqual([tokens[0], tokens[0], tokens[1], tokens[2]].map((token) => `Bearer ${token}`).sort());

    for (const [request, token] of [[first, tokens[0]], [second, tokens[1]], [changed, tokens[2]]]) {
      expect((await executor.execute(request)).response.status).toBe(200);
      expect(bearers.at(-1)).toBe(`Bearer ${token}`);
    }
    expect(refreshes).toHaveLength(3);
  });
  it("lets the remaining caller use the refresh when the first one aborts", async () => {
    const refreshGate = Promise.withResolvers();
    const token = jwt("shared");
    const fetcher = vi.fn(async (url, init) => {
      if (new URL(url).host === "securetoken.googleapis.com") {
        await refreshGate.promise;
        init.signal.throwIfAborted();
        return Response.json({ id_token: token });
      }
      expect(url).toBe("https://api2.twinmind.com/api/v3/chat");
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
      return events();
    });
    vi.stubGlobal("fetch", fetcher);
    const executor = new TwinmindExecutor();
    const controller = new AbortController();
    const first = executor.execute({ ...input("shared"), signal: controller.signal });
    const second = executor.execute(input("shared"));
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    refreshGate.resolve();
    expect((await second).response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps the replacement token when another request rejects the old bearer", async () => {
    const lateChatStarted = Promise.withResolvers();
    const lateRejection = Promise.withResolvers();
    const original = jwt("original");
    const replacement = jwt("replacement");
    const refreshes = [];
    const rejected = () => new Response(null, { status: 401 });
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (new URL(url).host === "securetoken.googleapis.com") {
        const refresh = new URLSearchParams(init.body).get("refresh_token");
        refreshes.push(refresh);
        return Response.json({ id_token: refresh === "shared" ? original : replacement, refresh_token: "rotated" });
      }
      expect(url).toBe("https://api2.twinmind.com/api/v3/chat");
      const bearer = new Headers(init.headers).get("authorization");
      const { query } = JSON.parse(init.body);
      if (bearer === `Bearer ${original}` && query.includes("late")) {
        lateChatStarted.resolve();
        await lateRejection.promise;
        return rejected();
      }
      if (bearer === `Bearer ${original}` && refreshes.length === 1 && query.includes("early")) return rejected();
      expect(bearer).toBe(query.includes("warmup") ? `Bearer ${original}` : `Bearer ${replacement}`);
      return events();
    }));
    const executor = new TwinmindExecutor();
    const request = (content) => {
      const call = input("shared");
      call.body.messages[0].content = content;
      return call;
    };
    expect((await executor.execute(request("warmup"))).response.status).toBe(200);
    const late = executor.execute(request("late"));
    await lateChatStarted.promise;
    expect((await executor.execute(request("early"))).response.status).toBe(200);
    lateRejection.resolve();
    expect((await late).response.status).toBe(200);
    expect(refreshes).toEqual(["shared", "rotated"]);
  });
  it("persists a rotated refresh token without replacing the saved API key", async () => {
    const persist = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url) => new URL(url).host === "securetoken.googleapis.com"
      ? Response.json({ id_token: jwt("one"), refresh_token: "rotated", expires_in: "3600" }) : events()));
    const request = input("original");
    request.credentials.providerSpecificData = { marker: "kept" };
    request.onCredentialsRefreshed = persist;
    expect((await new TwinmindExecutor().execute(request)).response.status).toBe(200);
    expect(persist).toHaveBeenCalledWith({ refreshToken: "rotated", providerSpecificPatch: {} });
  });
  it("rejects unsupported tool calls before dispatch", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const request = input("one"); request.body.tools = [{ type: "function" }];
    expect((await new TwinmindExecutor().execute(request)).response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("maps a rejected refresh token to a credential error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => { expect(new URL(url).host).toBe("securetoken.googleapis.com"); return Response.json({ error: "invalid" }, { status: 400 }); }));
    const result = await new TwinmindExecutor().execute(input("expired"));
    expect(result.response.status).toBe(401);
    expect((await result.response.json()).error.type).toBe("authentication_error");
  });
  it("preserves upstream rate limits", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => { expect(url).toBe("https://api2.twinmind.com/api/v3/chat"); return Response.json({ error: "quota" }, { status: 429 }); }));
    expect((await new TwinmindExecutor().execute(input(jwt("one")))).response.status).toBe(429);
  });
  it("rejects cross-origin redirects without forwarding credentials", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://other.invalid/" } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await new TwinmindExecutor().execute(input("refresh"))).response.status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
