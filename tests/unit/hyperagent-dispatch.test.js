/** Route coverage for HyperAgent; every upstream request is handled by a closed synthetic mock. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", async (importOriginal) => ({
  ...(await importOriginal()),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const ORIGIN = "https://hyperagent.com";
const answerFrames = (content, sessionId = "session-synthetic") => [
  { type: "session_start", sessionId },
  { type: "text", content },
].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const gatewayRequest = (url, body, headers = {}) => new Request(`http://gateway.invalid${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

let root, routes, handler, seen;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hyperagent-dispatch-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  seen = [];
  handler = null;
  vi.stubGlobal("fetch", async (input, init = {}) => {
    const url = String(input);
    seen.push({ url, init });
    if (!url.startsWith(ORIGIN) || !handler) throw new Error(`closed mock: unexpected host or request ${url}`);
    const result = await handler(url, init);
    if (!result) throw new Error(`closed mock: unexpected request ${url}`);
    return result;
  });
  routes = {
    providers: await import("../../src/app/api/providers/route.js"),
    chat: await import("../../src/app/api/v1/chat/completions/route.js"),
    messages: await import("../../src/app/api/v1/messages/route.js"),
  };
}, 60000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

async function saveConnection(name, cookie) {
  const response = await routes.providers.POST(gatewayRequest("/api/providers", { provider: "hyperagent", name, apiKey: cookie }));
  expect(response.status).toBe(201);
  return (await response.json()).connection;
}

function arm(answerForCookie = () => "synthetic reply") {
  handler = (url, init) => {
    const cookie = new Headers(init.headers).get("cookie");
    if (url === `${ORIGIN}/api/threads` && init.method === "POST") return json({ id: cookie.includes("account-b") ? "thread_account_b_0001" : "thread_account_a_0001" });
    if (/\/api\/threads\/[^/]+$/.test(url) && init.method === "PATCH") return json({ ok: true });
    if (/\/api\/threads\/[^/]+\/chat$/.test(url) && init.method === "POST") {
      return new Response(answerFrames(answerForCookie(cookie)), { headers: { "content-type": "text/event-stream" } });
    }
    return undefined;
  };
}

const openAiBody = (stream) => ({ model: "hyperagent/sonnet-latest", stream, messages: [{ role: "user", content: "say hello" }] });
const anthropicBody = (stream) => ({ model: "hyperagent/sonnet-latest", max_tokens: 80, stream, messages: [{ role: "user", content: "say hello" }] });

describe("HyperAgent chat dispatch (closed upstream mock)", () => {
  beforeEach(async () => { await saveConnection("synthetic", "session=synthetic-account-a"); arm(); });

  it.each([["OpenAI JSON", "chat", "/v1/chat/completions", openAiBody, false], ["OpenAI stream", "chat", "/v1/chat/completions", openAiBody, true], ["Anthropic JSON", "messages", "/v1/messages", anthropicBody, false], ["Anthropic stream", "messages", "/v1/messages", anthropicBody, true]])("returns %s responses", async (_label, routeName, endpoint, bodyBuilder, stream) => {
    const response = await routes[routeName].POST(gatewayRequest(endpoint, bodyBuilder(stream)));
    expect(response.status).toBe(200);
    if (stream) {
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const wire = await response.text();
      expect(wire).toContain("synthetic reply");
      expect(wire).toContain(routeName === "chat" ? "data: [DONE]" : "event: message_stop");
    } else {
      const result = await response.json();
      const text = routeName === "chat" ? result.choices[0].message.content : result.content.map((item) => item.text || "").join("");
      expect(text).toContain("synthetic reply");
    }
    expect(seen.map(({ url }) => new URL(url).pathname)).toEqual(["/api/threads", expect.stringMatching(/\/api\/threads\/thread_account_a_0001$/), "/api/threads/thread_account_a_0001/chat"]);
    expect(seen.every(({ init }) => new Headers(init.headers).get("cookie") === "session=synthetic-account-a")).toBe(true);
  });

  it.each([["expired cookie", 401, "authentication_error"], ["rate limited", 429, "rate_limit_error"]])("maps %s responses", async (_label, status, expectedType) => {
    handler = (url, init) => url === `${ORIGIN}/api/threads` && init.method === "POST" ? json({ error: "synthetic" }, status) : undefined;
    const response = await routes.chat.POST(gatewayRequest("/v1/chat/completions", openAiBody(false)));
    expect(response.status).toBe(status);
    expect((await response.json()).error.type).toBe(expectedType);
    expect(seen).toHaveLength(1);
    expect(seen[0].init.redirect).toBe("manual");
  });

  it("does not forward the cookie across an upstream cross-origin redirect", async () => {
    handler = (url, init) => url === `${ORIGIN}/api/threads` && init.method === "POST"
      ? new Response(null, { status: 302, headers: { location: "https://attacker.invalid/collect" } })
      : undefined;
    const response = await routes.chat.POST(gatewayRequest("/v1/chat/completions", openAiBody(false)));
    expect(response.status).toBe(401);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${ORIGIN}/api/threads`);
  });

  it("keeps two pinned connections' cookies and thread state separate", async () => {
    const first = await routes.providers.GET(new Request("http://gateway.invalid/api/providers"));
    expect(first.status).toBe(200);
    const second = await saveConnection("synthetic-second", "session=synthetic-account-b");
    arm((cookie) => cookie.includes("account-b") ? "reply for B" : "reply for A");
    const connections = (await (await routes.providers.GET(new Request("http://gateway.invalid/api/providers"))).json()).connections;
    const a = connections.find((item) => item.name === "synthetic");
    const b = connections.find((item) => item.name === "synthetic-second");
    expect(a?.id).toBeTruthy(); expect(b?.id || second.id).toBeTruthy();
    const responseA = await routes.chat.POST(gatewayRequest("/v1/chat/completions", openAiBody(false), { "x-connection-id": a.id }));
    const responseB = await routes.chat.POST(gatewayRequest("/v1/chat/completions", openAiBody(false), { "x-connection-id": b?.id || second.id }));
    expect((await responseA.json()).choices[0].message.content).toBe("reply for A");
    expect((await responseB.json()).choices[0].message.content).toBe("reply for B");
    expect(seen.filter(({ url }) => url.endsWith("/api/threads")).map(({ init }) => new Headers(init.headers).get("cookie"))).toEqual(["session=synthetic-account-a", "session=synthetic-account-b"]);
  });

  it("reuses the cookie-bound thread and session for follow-up turns", async () => {
    arm();
    const first = await routes.chat.POST(gatewayRequest("/v1/chat/completions", openAiBody(false)));
    expect(first.status).toBe(200);
    const followup = {
      model: "hyperagent/sonnet-latest",
      messages: [
        { role: "user", content: "say hello" },
        { role: "assistant", content: "synthetic reply" },
        { role: "user", content: "continue" },
      ],
    };
    const second = await routes.chat.POST(gatewayRequest("/v1/chat/completions", followup));
    expect(second.status).toBe(200);
    const creates = seen.filter(({ url, init }) => url === `${ORIGIN}/api/threads` && init.method === "POST");
    expect(creates).toHaveLength(1);
    const chatCalls = seen.filter(({ url }) => url.endsWith("/chat"));
    expect(chatCalls).toHaveLength(2);
    expect(JSON.parse(chatCalls[1].init.body).sessionId).toBe("session-synthetic");
  });
});
