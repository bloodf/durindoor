import "../translator/registerAll.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({ calls: [], reply: null }));
// Mock the actual transport boundary; keep the real executor and sender.
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: vi.fn(async (url, init, proxy) => {
    wire.calls.push({ url: String(url), init, proxy });
    if (init.signal.aborted) throw init.signal.reason;
    return wire.reply(url, init);
  }),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { saveRequestUsage } from "@/lib/usageDb.js";
import { ZaiWebExecutor } from "../../open-sse/executors/zai-web.js";
import { extractZaiCaptchaVerifyParam, resolveZaiCaptchaVerifyParam, resolveZaiWebSession } from "../../open-sse/executors/zai-web/session.js";
import { extractZaiWebToken } from "../../open-sse/executors/zai-web.js";
import { readZaiBody } from "../../open-sse/executors/zai-web/readBody.js";

const token = (id) => `h.${Buffer.from(JSON.stringify({ id })).toString("base64url")}.s`;
const sse = (text = 'data: {"data":{"phase":"answer","delta_content":"hello"}}\n\ndata: [DONE]\n\n') => new Response(text, { headers: { "content-type": "text/event-stream" } });
const input = (id = "a", extra = {}) => ({
  model: "glm-5.3", stream: false,
  credentials: { connectionId: id, providerSpecificData: { token: token(id) } },
  body: { messages: [{ role: "user", content: "hello" }], captcha_verify_param: `synthetic-proof-${id}` },
  proxyOptions: { connectionProxyEnabled: true, proxyPoolId: `route-${id}` },
  ...extra,
});
const run = (value = input()) => new ZaiWebExecutor().execute(value);
beforeEach(() => {
  wire.calls = [];
  wire.reply = (url) => String(url).endsWith("/new") ? Response.json({ id: "chat" }) : sse();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unexpected global fetch"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Z.ai pinned source proof contract", () => {
  it("uses the source proof aliases, nested data, credential JSON and precedence", () => {
    for (const name of ["captcha_verify_param", "captchaVerifyParam", "zaiCaptchaVerifyParam"]) {
      expect(extractZaiCaptchaVerifyParam({ [name]: " proof " })).toBe("proof");
    }
    expect(extractZaiCaptchaVerifyParam({ providerSpecificData: { captcha_verify_param: "nested" } })).toBe("nested");
    expect(extractZaiCaptchaVerifyParam('{"captcha_verify_param":"json"}')).toBe("json");
    expect(extractZaiCaptchaVerifyParam("token=x; captcha_verify_param=cookie")).toBe("cookie");
    expect(resolveZaiCaptchaVerifyParam({ providerSpecificData: { captcha_verify_param: "stored" } }, { captcha_verify_param: "request" })).toBe("request");
  });
  it("retains legacy credentials and refuses ambiguous or malformed explicit storage", async () => {
    const credentials = { apiKey: `token=${token("a")}` };
    expect(resolveZaiWebSession(credentials, extractZaiWebToken)).toBe(token("a"));
    for (const stored of [token("b"), "", null, {}]) {
      const result = await run(input("a", { credentials: { ...credentials, providerSpecificData: { token: stored } } }));
      expect(result.response.status).toBe(401);
    }
    expect(wire.calls).toHaveLength(0);
  });
  it("keeps two accounts, proxies, routes and supplied proofs bound to each physical request", async () => {
    for (const id of ["a", "b"]) {
      const result = await run(input(id));
      expect(result.response.status).toBe(200);
      expect((await result.response.json()).choices[0].message.content).toBe("hello");
      const calls = wire.calls.slice(-2);
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(new URL(call.url).origin).toBe("https://chat.z.ai");
        expect(call.init.headers.Authorization).toBe(`Bearer ${token(id)}`);
        expect(call.proxy.proxyPoolId).toBe(`route-${id}`);
        expect(call.init.redirect).toBe("manual");
      }
      expect(JSON.parse(calls[1].init.body).captcha_verify_param).toBe(`synthetic-proof-${id}`);
      expect(new URL(calls[1].url).searchParams.get("token")).toBe(token(id));
      expect(JSON.stringify(result.transformedBody)).not.toContain(`synthetic-proof-${id}`);
      expect(result.headers.Authorization).toBe("Bearer [REDACTED]");
      expect(result.url).not.toContain(token(id));
    }
    expect(wire.calls.filter((call) => call.url.includes("/completions?"))).toHaveLength(2);
  });
  it("refuses unsupported browser paths before setup or billable POST", async () => {
    for (const body of [
      { messages: [{ role: "user", content: "hello" }] },
      { messages: [{ role: "user", content: "hello" }], captcha_verify_param: " " },
      { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://invalid/image" } }] }], captcha_verify_param: "proof" },
    ]) {
      const result = await run(input("a", { body }));
      expect(result.response.status).toBe(400);
      expect((await result.response.json()).error.code).toBe("zai_proof_required");
      expect(result.claudeRequestScoped).toBe(false);
    }
    expect(wire.calls).toHaveLength(0);
  });
  it.each([
    () => Response.json({ detail: "rejected" }),
    () => new Response("<html>challenge</html>"),
    () => sse("data: bad-json\n\n"),
    () => sse('data: {"code":1,"message":"rejected"}\n\ndata: [DONE]\n\n'),
    () => sse('data: {"data":{"error":{"message":"expired proof"}}}\n\n'),
    () => sse('data: {"data":{"delta_content":"partial"}}\n\n'),
    () => sse('data: [DONE]\n\n'),
  ])("fails closed on malformed, non-stream, nonzero, expired/challenge or incomplete responses", async (reply) => {
    wire.reply = (url) => String(url).endsWith("/new") ? Response.json({ id: "chat" }) : reply();
    const result = await run();
    expect(result.response.status).toBe(502);
    expect(result.claudeRequestScoped).toBe(true);
    expect(await result.response.text()).not.toMatch(/finish_reason|usage/);
    expect(wire.calls).toHaveLength(2);
  });
  it("returns a valid buffered stream with one billable call", async () => {
    const result = await run(input("a", { stream: true }));
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toContain('"finish_reason":"stop"');
    expect(wire.calls).toHaveLength(2);
  });
  it("refuses redirects and redacts transport failures without retrying", async () => {
    for (const failure of [new Response(null, { status: 307, headers: { location: "https://other.invalid" } }), new Error(`secret ${token("a")} synthetic-proof-a`)]) {
      wire.calls = [];
      wire.reply = (url) => {
        if (String(url).endsWith("/new")) return Response.json({ id: "chat" });
        if (failure instanceof Error) throw failure;
        return failure;
      };
      const result = await run();
      expect(result.response.ok).toBe(false);
      expect(result.claudeRequestScoped).toBe(true);
      expect(await result.response.text()).not.toMatch(/synthetic-proof|secret |h\./);
      expect(wire.calls).toHaveLength(2);
    }
  });
  it("leaves a setup failure before the billable POST open to account fallback, but not a completion failure", async () => {
    // Setup (chats/new) is not quota-bearing, so no completion work is uncertain yet.
    for (const setup of [() => new Response("expired", { status: 401 }), () => { throw new Error("synthetic setup socket failure"); }, () => Response.json({})]) {
      wire.calls = [];
      wire.reply = (url) => (String(url).endsWith("/new") ? setup() : sse());
      const result = await run();
      expect(result.response.ok).toBe(false);
      expect(result.claudeRequestScoped).toBe(false);
      expect(wire.calls.map((call) => new URL(call.url).pathname)).toEqual(["/api/v1/chats/new"]);
      expect(await result.response.text()).not.toMatch(/synthetic-proof|synthetic setup|h\./);
    }
    // A completion send that throws is uncertain work and stays terminal.
    wire.calls = [];
    wire.reply = (url) => { if (String(url).endsWith("/new")) return Response.json({ id: "chat" }); throw new Error("synthetic completion socket failure"); };
    const failed = await run();
    expect(failed.claudeRequestScoped).toBe(true);
    expect(wire.calls).toHaveLength(2);
  });
  it("honors cancellation before dispatch and during a pending response body", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run(input("a", { signal: controller.signal }))).rejects.toThrow();
    expect(wire.calls).toHaveLength(0);
    const pending = new AbortController();
    wire.reply = (url) => {
      if (String(url).endsWith("/new")) return Response.json({ id: "chat" });
      const response = new Response(new ReadableStream({ start() { queueMicrotask(() => pending.abort()); } }), { headers: { "content-type": "text/event-stream" } });
      return response;
    };
    await expect(run(input("a", { signal: pending.signal }))).rejects.toThrow();
    expect(wire.calls).toHaveLength(2);
  });
  it("bounds stalled body reads by a local deadline and cancels the transport", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    await expect(readZaiBody(response, undefined, 5)).rejects.toThrow();
    expect(cancel).toHaveBeenCalled();
  });
});


describe("Z.ai failures through real client format handlers", () => {
  it.each([
    ["/v1/chat/completions", FORMATS.OPENAI, false],
    ["/v1/chat/completions", FORMATS.OPENAI, true],
    ["/v1/messages", FORMATS.CLAUDE, false],
    ["/v1/messages", FORMATS.CLAUDE, true],
  ])("terminates %s format=%s stream=%s without a success terminal or usage", async (endpoint, format, stream) => {
    wire.reply = (url) => String(url).endsWith("/new") ? Response.json({ id: "chat" }) : sse('data: {"data":{"error":{"message":"expired or different challenge"}}}\n\n');
    const body = { model: "zai-web/glm-5.3", messages: [{ role: "user", content: "hello" }], max_tokens: 50, stream };
    const credentials = { ...input().credentials, authType: "cookie", providerSpecificData: { token: token("a"), captcha_verify_param: "synthetic-proof-a" } };
    const refreshCredentials = vi.fn();
    vi.mocked(saveRequestUsage).mockClear();
    const result = await handleChatCore({ body, modelInfo: { provider: "zai-web", model: "glm-5.3" }, credentials,
      executorOverride: new ZaiWebExecutor(), connectionId: "a", sourceFormatOverride: format,
      clientRawRequest: { endpoint, body, headers: {} }, refreshCredentials,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    expect(result.success).toBe(false);
    expect(result.claudeRequestScoped).toBe(true);
    const text = await result.response.text();
    expect(text).toContain('"error"');
    expect(text).not.toMatch(/finish_reason|message_stop|synthetic-proof|expired or different challenge/);
    expect(wire.calls).toHaveLength(2);
    expect(refreshCredentials).not.toHaveBeenCalled();
    expect(saveRequestUsage).not.toHaveBeenCalled();
  });
});
