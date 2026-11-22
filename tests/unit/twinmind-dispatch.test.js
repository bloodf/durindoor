import { afterEach, describe, expect, it, vi } from "vitest";
import { TwinmindExecutor } from "../../open-sse/executors/twinmind.js";
const jwt = (name) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: name, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.synthetic`;
const input = (key) => ({ model: "auto", body: { model: "auto", messages: [{ role: "user", content: "ping" }] }, credentials: { apiKey: key }, connectionId: key, stream: false });
const events = () => new Response('data: {"type":"text_start","content":"hel"}\n\ndata: {"type":"text_delta","content":"lo"}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
afterEach(() => vi.unstubAllGlobals());
describe("TwinMind dispatch", () => {
  it("refreshes once, reuses the token, and isolates connections", async () => {
    const seen = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      expect(init.redirect).toBe("manual");
      if (new URL(url).host === "securetoken.googleapis.com") {
        const refresh = new URLSearchParams(init.body).get("refresh_token");
        seen.push(`refresh:${refresh}`);
        return Response.json({ id_token: jwt(refresh), refresh_token: refresh, expires_in: "3600" });
      }
      expect(url).toBe("https://api2.twinmind.com/api/v3/chat");
      expect(JSON.parse(init.body)).toMatchObject({ type: "app", mode: "private", model: { model_name: "gpt-5.6-sol-thinking" } });
      seen.push(new Headers(init.headers).get("authorization"));
      return events();
    }));
    const executor = new TwinmindExecutor();
    for (const key of ["one", "one", "two"]) expect((await (await executor.execute(input(key))).response.json()).choices[0].message.content).toBe("hello");
    expect(seen.filter((item) => item.startsWith("refresh:"))).toEqual(["refresh:one", "refresh:two"]);
    expect(seen[1]).toBe(`Bearer ${jwt("one")}`);
    expect(seen[4]).toBe(`Bearer ${jwt("two")}`);
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
