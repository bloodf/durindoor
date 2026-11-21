import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/providers/registry/index.js", async (original) => { const o = await original(); const { default: entry } = await import("../../open-sse/providers/private/notrack-web.js"); return { ...o, default: [...o.default, entry] }; });
vi.mock("../../open-sse/executors/index.js", async (original) => { const o = await original(); const { NotrackWebExecutor } = await import("../../open-sse/executors/notrack-web.js"); const executor = new NotrackWebExecutor(mock.fetch); return { ...o, getExecutor: (id) => id === "notrack-web" || id === "ntw" ? executor : o.getExecutor(id), hasSpecializedExecutor: (id) => id === "notrack-web" || o.hasSpecializedExecutor(id) }; });

import entry, { notrackWebCookieProfile } from "../../open-sse/providers/private/notrack-web.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { hasNotrackSession } from "../../open-sse/executors/notrack-web.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

const COOKIE_A = "uid=uid-a; si_usr_id=user-a; si_ses_id=session-a";
const COOKIE_B = "uid=uid-b; si_usr_id=user-b; si_ses_id=session-b";
const sse = (...events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const request = (cookie, { stream = false, endpoint = "/v1/chat/completions", anthropic = false } = {}) => {
  const model = "notrack-c";
  const body = anthropic ? { model, max_tokens: 64, stream, messages: [{ role: "user", content: "hi" }] } : { model, stream, messages: [{ role: "user", content: "hi" }] };
  const credentials = { id: cookie.includes("uid-a") ? "a" : "b", provider: "notrack-web", apiKey: cookie };
  return handleChatCore({ body, modelInfo: { provider: "notrack-web", model }, credentials, connectionId: credentials.id, clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: anthropic ? "claude" : undefined, log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
};

afterEach(() => vi.clearAllMocks());

describe("NoTrack Web staged provider", () => {
  it("exports the provider and cookie capture profile", () => {
    expect(entry).toMatchObject({ id: "notrack-web", alias: "ntw", category: "webCookie", transport: { executor: "notrack-web" } });
    expect(notrackWebCookieProfile).toMatchObject({ domains: ["notrack.ai"], cookieNames: ["uid", "si_usr_id", "si_ses_id", "nt_session"], validationProbe: { method: "POST" } });
    expect(REGISTRY.some((p) => p.id === "notrack-web")).toBe(true);
    expect(PROVIDERS["notrack-web"]).toMatchObject({ baseUrl: "https://notrack.ai/api/dispatch", format: "openai" });
    expect(PROVIDER_MODELS.ntw).toEqual([{ id: "notrack-c", name: "NoTrack C", aliases: ["C", "notrack", "ntw"] }]);
  });

  it("accepts a pasted session header and rejects an empty validation value", () => {
    expect(hasNotrackSession(`Cookie: ${COOKIE_A}`)).toBe(true);
    expect(hasNotrackSession("  ")).toBe(false);
  });

  it("rejects missing cookies and empty requests before dispatch", async () => {
    const executor = getExecutor("notrack-web");
    expect((await executor.execute({ body: { messages: [] }, credentials: { apiKey: COOKIE_A } })).response.status).toBe(400);
    expect((await executor.execute({ body: { messages: [{ role: "user", content: "hi" }] }, credentials: {} })).response.status).toBe(401);
    expect(mock.fetch).not.toHaveBeenCalled();
  });

  it("dispatches separate connection cookies and routes JSON through OpenAI and Anthropic chat APIs", async () => {
    mock.fetch.mockImplementation(async (_url, init) => { expect(init.headers.cookie).toMatch(/uid=uid-[ab]/); return sse({ type: "delta", chunk: "Hello" }); });
    const a = await request(COOKIE_A);
    const b = await request(COOKIE_B, { endpoint: "/v1/messages", anthropic: true });
    expect(a.success).toBe(true); expect(b.success).toBe(true);
    expect(await a.response.json()).toMatchObject({ choices: [{ message: { content: "Hello" } }] });
    expect(await b.response.json()).toMatchObject({ content: [{ type: "text", text: "Hello" }] });
    expect(mock.fetch).toHaveBeenCalledTimes(2);
  });

  it("converts upstream event deltas to OpenAI chunks through the OpenAI chat route", async () => {
    mock.fetch.mockResolvedValue(sse({ type: "chat_meta", chat_id: "synthetic" }, { type: "delta", chunk: "Hi" }));
    const result = await request(COOKIE_A, { stream: true });
    expect(result.success).toBe(true);
    const text = await result.response.text();
    expect(text).toContain('"content":"Hi"'); expect(text).toContain('"finish_reason":"stop"'); expect(text).toContain("data: [DONE]");
  });

  it("converts streamed Anthropic messages through the messages route", async () => {
    mock.fetch.mockResolvedValue(sse({ type: "delta", chunk: "Anthropic" }));
    const result = await request(COOKIE_A, { stream: true, endpoint: "/v1/messages", anthropic: true });
    expect(result.success).toBe(true);
    const text = await result.response.text();
    expect(text).toContain("content_block_delta"); expect(text).toContain("Anthropic"); expect(text).toContain("message_stop");
  });

  it("maps expired sessions and quota responses", async () => {
    mock.fetch.mockResolvedValueOnce(new Response("expired", { status: 401 })).mockResolvedValueOnce(new Response("quota", { status: 429 }));
    expect((await getExecutor("notrack-web").execute({ body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: COOKIE_A } })).response.status).toBe(401);
    expect((await getExecutor("notrack-web").execute({ body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: COOKIE_A } })).response.status).toBe(429);
  });
});
