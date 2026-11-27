// Public Claude contracts, complementing the four preserved provider suites.
// MIT sources: CLIProxyAPI dbe641f internal/auth/claude/anthropic_auth.go;
// OmniRoute b15b2ee src/lib/oauth/providers/claude.ts. Neither has a device grant.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BUFFER_TOKENS } from "../../open-sse/utils/usageTracking.js";

const previous = { ...process.env };
const root = fs.mkdtempSync(path.join(os.tmpdir(), "register-auth-public-"));
process.env.DATA_DIR = path.join(root, "data");
fs.mkdirSync(process.env.DATA_DIR);
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: (...args) => outbound(...args) }));
const calls = [];
const LEAK = "synthetic-provider-secret";
let refusal = false;
async function outbound(input, init = {}, proxyOptions) {
  const url = String(input);
  calls.push({ url, init, proxyOptions });
  if (url === "https://auth.openai.com/oauth/token") {
    const body = new URLSearchParams(init.body);
    const slug = body.get("code") || body.get("refresh_token");
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const idToken = `${encode({ alg: "none" })}.${encode({ email: `${slug}@example.test`, "https://api.openai.com/auth": { chatgpt_account_id: `account-${slug}` } })}.sig`;
    return Response.json({ access_token: `codex-access-${slug}`, refresh_token: `codex-refresh-${slug}`, id_token: idToken, expires_in: 3600 });
  }
  if (url.includes("/codex/models")) return Response.json({ models: [{ slug: "gpt-6.1-sol" }] });
  if (url.includes("/codex/responses")) {
    const response = { id: "resp-public", object: "response", model: "gpt-6.1-sol", status: "completed", output: [{ id: "msg-1", type: "message", role: "assistant", content: [{ type: "output_text", text: "codex hello", annotations: [] }] }], usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } };
    const events = [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { id: "msg-1", type: "message", role: "assistant", content: [] } },
      { type: "response.output_text.delta", item_id: "msg-1", output_index: 0, content_index: 0, delta: "codex hello" },
      { type: "response.output_item.done", output_index: 0, item: response.output[0] },
      { type: "response.completed", response }
    ];
    return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  }
  if (url.includes("/oauth/token")) {
    const body = JSON.parse(init.body);
    if (body.code === "refuse") return new Response(LEAK, { status: 400 });
    const slug = body.code || body.refresh_token;
    return Response.json({ access_token: `synthetic-access-${slug}`, refresh_token: slug, expires_in: 3600 });
  }
  if (url.includes("/oauth/profile")) {
    const token = new Headers(init.headers).get("authorization");
    return Response.json({ account: { uuid: token, email: `${token.split("-").at(-1)}@example.test` }, organization: { uuid: `org-${token}` } });
  }
  if (url.includes("/v1/models")) return Response.json({ data: [{ id: "claude-sonnet-4-6", display_name: "Sonnet" }] });
  if (url.includes("/messages/count_tokens")) return Response.json({ input_tokens: 7 });
  if (url.includes("/messages")) {
    if (refusal) return Response.json({ error: { type: "permission_error", message: "refused" } }, { status: 403 });
    const body = JSON.parse(init.body);
    const message = { id: "msg-public", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "public hello" }], stop_reason: "end_turn", usage: { input_tokens: 7, output_tokens: 3 } };
    if (!body.stream) return Response.json(message);
    const events = [
      { type: "message_start", message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 7, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "public hello" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
      { type: "message_stop" }
    ];
    return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  }
  throw new Error(`Unexpected outbound URL: ${url}`);
}
let oauth, db, chat, messages, models, providerModels;
beforeAll(async () => {
  vi.stubGlobal("fetch", outbound);
  oauth = await import("@/app/api/oauth/[provider]/[action]/route.js");
  db = await import("@/lib/localDb");
  chat = await import("@/app/api/v1/chat/completions/route.js");
  messages = await import("@/app/api/v1/messages/route.js");
  models = await import("@/app/api/v1/models/route.js");
  providerModels = await import("@/app/api/providers/[id]/models/route.js");
  vi.stubGlobal("fetch", outbound);
}, 120_000);
beforeEach(() => { calls.length = 0; refusal = false; });
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); process.env = previous; fs.rmSync(root, { recursive: true, force: true }); });
async function post(action, body, provider = "claude") {
  return oauth.POST(new Request(`http://localhost/api/oauth/${provider}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ provider, action }) });
}
async function start(provider = "claude", extra = {}) {
  const response = await post("authorize", { proxyMode: "direct", ...extra }, provider);
  expect(response.status).toBe(200);
  return response.json();
}
async function exchange(flow, code) {
  return post("exchange", { code, state: flow.state, flowId: flow.flowId });
}
function noLeaks(text) {
  expect(text).not.toContain(LEAK);
  expect(text).not.toContain("synthetic-access-");
}

describe("registered public sign-in contracts", () => {
  it("keeps ChatGPT plan enrollment closed without its explicit operator gate", async () => {
    const enrollment = await import("@/app/api/oauth/chatgpt-plan/enrollment/route.js");
    const response = await enrollment.POST(new Request("http://localhost/api/oauth/chatgpt-plan/enrollment", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ action: "create", name: "plan" }) }));
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("rejects unsupported Codex modes on both public entry points before transport", async () => {
    for (const action of ["authorize", "device-code"]) {
      expect((await post(action, { loginMode: "siwc" }, "codex")).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("binds Claude pasted state before transport and never retries an accepted exchange", async () => {
    const flow = await start();
    const bad = await exchange(flow, "one#foreign");
    expect(bad.status).toBe(400);
    expect(calls).toHaveLength(0);
    // Failed exchange consumes its one-use claim; start a fresh flow.
    const fresh = await start();
    const accepted = await exchange(fresh, `one#${fresh.state}`);
    const text = await accepted.text();
    expect(accepted.status, text).toBe(200);
    noLeaks(text);
    expect((await exchange(fresh, `one#${fresh.state}`)).status).toBeGreaterThanOrEqual(400);
    expect(calls.filter((call) => call.url.includes("/oauth/token"))).toHaveLength(1);
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ code: "one", state: fresh.state, grant_type: "authorization_code" });
    expect(body.code_verifier).toBeTruthy();
  });

  it("keeps two accounts and their selected strict proxies separate", async () => {
    for (const slug of ["alpha", "beta"]) {
      const pool = await db.createProxyPool({ name: slug, proxyUrl: `http://${slug}.invalid:8080`, isActive: true });
      const flow = await start("claude", { proxyMode: "strict-pool", proxyPoolId: pool.id });
      const response = await exchange(flow, slug);
      const text = await response.text();
      expect(response.status, text).toBe(200);
      noLeaks(text);
      const row = await db.getProviderConnectionById(JSON.parse(text).connection.id);
      expect(row).toMatchObject({ provider: "claude", accessToken: `synthetic-access-${slug}`, refreshToken: slug, providerSpecificData: { proxyPoolId: pool.id } });
      const own = calls.slice(-2);
      expect(own).toHaveLength(2);
      for (const call of own) expect(call.init.proxyOptions).toMatchObject({ proxyPoolId: pool.id });
    }
  });

  it("redacts rejected grants and refuses unsupported device and import modes", async () => {
    const flow = await start();
    const response = await exchange(flow, "refuse");
    expect(response.status).toBeGreaterThanOrEqual(400);
    noLeaks(await response.text());
    const count = calls.length;
    for (const action of ["device-code", "import-token"]) expect((await post(action, { token: LEAK })).status).toBeGreaterThanOrEqual(400);
    expect(calls).toHaveLength(count);
  });

  it.each(["claude", "codex", "gemini-cli", "antigravity"])("expires and cancels %s browser flows before exchange", async (provider) => {
    const complete = (flow, code) => post("exchange", { code, state: flow.state, flowId: flow.flowId }, provider);
    const cancelled = await start(provider);
    expect((await post("cancel", { flowId: cancelled.flowId, state: cancelled.state }, provider)).status).toBe(200);
    expect((await complete(cancelled, "cancelled")).status).toBeGreaterThanOrEqual(400);
    vi.useFakeTimers();
    try {
      const expired = await start(provider);
      vi.setSystemTime(new Date(expired.expiresAt).getTime() + 1);
      expect((await complete(expired, "expired")).status).toBeGreaterThanOrEqual(400);
    } finally { vi.useRealTimers(); }
    expect(calls).toHaveLength(0);
  });
});

describe("Claude public discovery and inference", () => {
  let selected;
  beforeAll(async () => {
    for (const row of await db.getProviderConnections({ provider: "claude" })) {
      if (row.refreshToken === "alpha") selected = row;
      else await db.updateProviderConnection(row.id, { isActive: false });
    }
  });
  it("discovers models using the selected bearer and publishes the inventory", async () => {
    const response = await providerModels.GET(new Request(`http://localhost/api/providers/${selected.id}/models`), { params: Promise.resolve({ id: selected.id }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("claude-sonnet-4-6");
    const probes = calls.filter((call) => call.url.includes("/v1/models"));
    expect(probes).toHaveLength(1);
    expect(new Headers(probes[0].init.headers).get("authorization")).toBe("Bearer synthetic-access-alpha");
    const list = await models.GET(new Request("http://localhost/v1/models"));
    expect(await list.text()).toContain("claude-sonnet-4-6");
  });
  it.each([["chat/completions", false], ["chat/completions", true], ["messages", false], ["messages", true]])("serves %s stream=%s with usage on the selected account", async (endpoint, stream) => {
    const handler = endpoint === "messages" ? messages : chat;
    const response = await handler.POST(new Request(`http://localhost/v1/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "cc/claude-sonnet-4-6", max_tokens: 32, stream, stream_options: { include_usage: true }, messages: [{ role: "user", content: "Hi" }] }) }));
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain("public hello");
    expect(text).toContain("usage");
    // OpenAI usage keeps the gateway's existing input buffer; native Claude is exact.
    expect(text).toContain(endpoint === "messages" ? '"input_tokens":7' : `"prompt_tokens":${7 + DEFAULT_BUFFER_TOKENS}`);
    expect(text).toContain(endpoint === "messages" ? '"output_tokens":3' : '"completion_tokens":3');
    noLeaks(text);
    const sent = calls.filter((call) => /\/messages(?:\?|$)/.test(call.url));
    expect(sent).toHaveLength(1);
    expect(new Headers(sent[0].init.headers).get("authorization")).toBe("Bearer synthetic-access-alpha");
    expect(sent[0].proxyOptions).toMatchObject({ proxyPoolId: selected.providerSpecificData.proxyPoolId });
  });
  it("refreshes expiry through the public request and preserves the connection identity", async () => {
    const { __clearRefreshDedupCacheForTesting } = await import("../../open-sse/services/tokenRefresh/dedup.js");
    __clearRefreshDedupCacheForTesting();
    await db.updateProviderConnection(selected.id, { expiresAt: new Date(Date.now() - 60_000).toISOString(), expiresIn: 1 });
    const response = await chat.POST(new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "cc/claude-sonnet-4-6", messages: [{ role: "user", content: "Hi" }] }) }));
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(calls.filter((call) => call.url.includes("/oauth/token"))).toHaveLength(1);
    const refreshed = await db.getProviderConnectionById(selected.id);
    expect(refreshed.id).toBe(selected.id);
    expect(refreshed.refreshToken).toBe("alpha");
    noLeaks(text);
  });
  it("bounds refused inference recovery to one credential refresh without leaks", async () => {
    refusal = true;
    const response = await chat.POST(new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "cc/claude-sonnet-4-6", messages: [{ role: "user", content: "Hi" }] }) }));
    const text = await response.text();
    expect(response.status).toBe(403);
    noLeaks(text);
    // chatCore permits one recovery after a rejected 403, never after success.
    expect(calls.filter((call) => /\/messages(?:\?|$)/.test(call.url))).toHaveLength(2);
  });
});


describe("Codex public inference after registered exchange", () => {
  let selected;
  beforeAll(async () => {
    const flow = await start("codex");
    const response = await post("exchange", { flowId: flow.flowId, state: flow.state, code: "public" }, "codex");
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).not.toContain("codex-access-public");
    selected = await db.getProviderConnectionById(JSON.parse(text).connection.id);
  });
  it("discovers with the signed-in account header", async () => {
    const response = await providerModels.GET(new Request(`http://localhost/api/providers/${selected.id}/models`), { params: Promise.resolve({ id: selected.id }) });
    expect(response.status, await response.clone().text()).toBe(200);
    const call = calls.find((call) => call.url.includes("/codex/models"));
    expect(new Headers(call.init.headers).get("chatgpt-account-id")).toBe("account-public");
  });
  it.each([["chat/completions", false], ["chat/completions", true], ["messages", false], ["messages", true]])("serves %s stream=%s without replay", async (endpoint, stream) => {
    const handler = endpoint === "messages" ? messages : chat;
    const response = await handler.POST(new Request(`http://localhost/v1/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "cx/gpt-6.1-sol", max_tokens: 32, stream, messages: [{ role: "user", content: "Hi" }] }) }));
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain("codex hello");
    expect(text).not.toContain("codex-access-");
    expect(text).not.toContain("codex-refresh-");
    const sent = calls.filter((call) => call.url.includes("/codex/responses"));
    expect(sent).toHaveLength(1);
    expect(new Headers(sent[0].init.headers).get("authorization")).toBe("Bearer codex-access-public");
    expect(new Headers(sent[0].init.headers).get("chatgpt-account-id")).toBe("account-public");
  });
});
