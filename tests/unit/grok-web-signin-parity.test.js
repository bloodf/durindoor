import { afterEach, describe, expect, it, vi } from "vitest";
import { beginSession, destroySession, absorbSetCookies, composeCookieHeader, getSession, SESSION_TTL_MS } from "../../src/lib/webLoginSession.js";
import { getProvider } from "../../src/lib/oauth/providers.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const event = (response) => JSON.stringify({ result: { response } }) + "\n";
const request = (apiKey, stream = true) => getExecutor("grok-web").execute({
  model: "grok-4", body: { messages: [{ role: "user", content: "hello" }] },
  stream, credentials: { apiKey },
});

afterEach(() => vi.unstubAllGlobals());

describe("Grok Web session request compatibility", () => {
  it("streams a final-only response without dropping it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(event({ modelResponse: { message: "hello back" } }))));
    const { response } = await request("first-session");
    const text = await response.text();
    expect(text).toContain('"content":"hello back"');
    expect(text).toContain("[DONE]");
  });

  it("does not repeat the final message after token chunks and isolates session cookies", async () => {
    const fetch = vi.fn(async () => new Response(event({ token: "hello" }) + event({ modelResponse: { message: "hello" } })));
    vi.stubGlobal("fetch", fetch);
    const first = await request("sso=first-session");
    const second = await request("second-session", false);
    expect((await first.response.text()).match(/"content":"hello"/g)).toHaveLength(1);
    expect((await second.response.json()).choices[0].message.content).toBe("hello");
    expect(fetch.mock.calls.map(([, init]) => init.headers.Cookie)).toEqual(["sso=first-session", "sso=second-session"]);
  });

  it.each([401, 403, 429])("preserves upstream HTTP %s and reports an actionable error", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status })));
    const { response } = await request("expired-session");
    expect(response.status).toBe(status);
    expect((await response.json()).error.message).toMatch(status === 429 ? /rate limited/i : /expired/i);
  });
});

 it("keeps the web sign-in session separate from OAuth and expires it", () => {
  vi.useFakeTimers();
  const session = beginSession("grok-web", { owner: "operator", dashboardOrigin: "https://dashboard.example", loginOrigin: "https://login.example" });
  try {
    expect(session).toBeTruthy();
    expect(() => getProvider("grok-web")).toThrow("Unknown provider");
    const headers = new Headers({ "set-cookie": "sso=fake-session; Path=/" });
    absorbSetCookies(session, new Response(null, { headers }), "https://grok.com/");
    expect(composeCookieHeader(session)).toBe("sso=fake-session");
    vi.advanceTimersByTime(SESSION_TTL_MS + 1);
    expect(getSession(session.id)).toBeNull();
  } finally { destroySession(session.id); vi.useRealTimers(); }
});
