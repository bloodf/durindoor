import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: vi.fn(async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() })) }));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn() }));
// The physical dispatch is where the gateway admits or denies quota capacity.
// Reproduce that boundary here so a local denial is proven to happen before
// any send, and so the dispatch ticket lands on the physical upstream
// Response exactly as it does in production.
vi.mock("open-sse/utils/proxyFetch.js", async () => {
  const attemptContext = await import("../../open-sse/services/providerAttemptContext.js");
  return {
    proxyAwareFetch: vi.fn((url, init, proxyOptions) =>
      attemptContext.runProviderAttemptDispatch(() => transport(url, init, proxyOptions))),
  };
});
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "fixture", updateKimchiUserAgent: vi.fn() }));
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import {
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch,
} from "../../open-sse/services/providerAttemptContext.js";
import { QuotaDispatchUnavailableError } from "../../open-sse/services/quota/dispatch.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { buildRegistryProviderProbe, probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { getProviderConnectionById } from "@/lib/localDb";
import { GET as getConnectionModels } from "../../src/app/api/providers/[id]/models/route.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

const model = "chatdolphin";
const body = { messages: [{ role: "system", content: "Be brief" }, { role: "user", content: "First" }, { role: "assistant", content: "Answer" }, { role: "user", content: [{ type: "text", text: "Next" }] }] };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const execute = (options = {}) => getExecutor("nlpc").execute({ model, body, stream: false, credentials: { apiKey: "fixture-account-a" }, ...options });
const nativeStream = (body) => new Response(body, { headers: { "Content-Type": "text/event-stream" } });
const bytes = (...parts) => new ReadableStream({ start(c) { for (const part of parts) c.enqueue(new TextEncoder().encode(part)); c.close(); } });
// A quota reservation ticket stands in for the gateway's reservation ledger.
const quotaTicket = (reservationId) => ({
  tracked: true,
  reservationId,
  heartbeat: vi.fn(),
  settle: vi.fn(async () => ({ changed: true })),
  release: vi.fn(async (reason) => ({ changed: true, reason })),
});
const chatOptions = (overrides = {}, stream = false) => {
  const requestBody = { model, stream, messages: [{ role: "user", content: "Question" }] };
  return {
    body: requestBody,
    modelInfo: { provider: "nlpcloud", model },
    credentials: { apiKey: "fixture-account-b" },
    connectionId: "selected",
    clientRawRequest: { endpoint: "/v1/chat/completions", body: requestBody, headers: { accept: stream ? "text/event-stream" : "application/json" } },
    sourceFormatOverride: FORMATS.OPENAI,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
};

beforeEach(() => { transport.mockReset(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network"); })); });
afterEach(() => vi.unstubAllGlobals());

describe("NLP Cloud provider", () => {
  it("exposes the first-party chatbot catalog and dashboard provider", () => {
    expect(AI_PROVIDERS.nlpcloud.name).toBe("NLP Cloud");
    expect(getProviderModels("nlpc").map((m) => m.id)).toEqual(["gpt-oss-120b", "llama-3-1-405b", "finetuned-llama-3-70b", "chatdolphin", "dolphin-yi-34b", "dolphin-mixtral-8x7b"]);
  });
  it("lists the documented static catalog through the connection models route", async () => {
    getProviderConnectionById.mockResolvedValue({ id: "selected", provider: "nlpcloud", apiKey: "fixture-account-a" });
    const response = await getConnectionModels(new Request("http://localhost/api/providers/selected/models"), { params: Promise.resolve({ id: "selected" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.source).toBe("static");
    expect(data.models.map((item) => item.id)).toEqual(getProviderModels("nlpc").map((item) => item.id));
    expect(transport).not.toHaveBeenCalled();
  });
  it("uses the selected account and model with native request and normalized response", async () => {
    transport.mockResolvedValueOnce(json({ response: "Hello", history: [] }));
    const result = await execute({ model: "gpt-oss-120b", credentials: { apiKey: "fixture-account-b" } });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://api.nlpcloud.io/v1/gpu/gpt-oss-120b/chatbot");
    expect(init.headers.Authorization).toBe("Bearer fixture-account-b");
    expect(JSON.parse(init.body)).toEqual({ input: "Next", context: "Be brief", history: [{ input: "First", response: "Answer" }] });
    expect(await result.response.json()).toMatchObject({ model: "gpt-oss-120b", choices: [{ message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }] });
    const response = await execute({ credentials: {} });
    expect(response.response.status).toBe(401);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("routes chatCore through the selected account and refuses images before stripping", async () => {
    const requestBody = { model, stream: false, messages: [{ role: "user", content: "Question" }] };
    const options = { body: requestBody, modelInfo: { provider: "nlpcloud", model }, credentials: { apiKey: "fixture-account-b" }, connectionId: "selected", clientRawRequest: { endpoint: "/v1/chat/completions", body: requestBody, headers: { accept: "application/json" } }, sourceFormatOverride: FORMATS.OPENAI, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    transport.mockResolvedValueOnce(json({ response: "answer" }));
    const result = await handleChatCore(options);
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("answer");
    expect(transport.mock.calls[0][1].headers.Authorization).toBe("Bearer fixture-account-b");
    const imageBody = { ...requestBody, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.test/image" } }] }] };
    const invalid = await handleChatCore({ ...options, body: imageBody, clientRawRequest: { ...options.clientRawRequest, body: imageBody } });
    expect(invalid.status).toBe(400);
    const claudeBody = { model, max_tokens: 20, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } }] }] };
    const claude = await handleChatCore({ ...options, body: claudeBody, sourceFormatOverride: FORMATS.CLAUDE, clientRawRequest: { ...options.clientRawRequest, body: claudeBody } });
    expect(claude.status).toBe(400);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("streams native text through chatCore", async () => {
    const requestBody = { model, stream: true, messages: [{ role: "user", content: "Question" }] };
    transport.mockResolvedValueOnce(new Response(bytes("Hello ", "world[D", "ONE]"), { headers: { "Content-Type": "text/event-stream" } }));
    const result = await handleChatCore({ body: requestBody, modelInfo: { provider: "nlpcloud", model }, credentials: { apiKey: "fixture-account-b" }, connectionId: "selected", clientRawRequest: { endpoint: "/v1/chat/completions", body: requestBody, headers: { accept: "text/event-stream" } }, sourceFormatOverride: FORMATS.OPENAI, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    expect(result.success).toBe(true);
    const text = await result.response.text();
    const frames = text.split("\n\n").filter((frame) => frame.startsWith("data: {" )).map((frame) => JSON.parse(frame.slice(6)));
    expect(frames.map((frame) => frame.choices?.[0]?.delta?.content || "").join("")).toBe("Hello world");
    expect(text).toContain("[DONE]");
    expect(transport.mock.calls[0][1].headers.Authorization).toBe("Bearer fixture-account-b");
  });
  it("does not fabricate token usage", async () => {
    transport.mockResolvedValueOnce(json({ response: "answer" }));
    expect(await (await execute()).response.json()).not.toHaveProperty("usage");
  });
  it("probes the actual chatbot endpoint and rejects auth failures", async () => {
    const probe = buildRegistryProviderProbe("nlpcloud", "fixture-account-b");
    expect(probe.url).toBe("https://api.nlpcloud.io/v1/gpu/chatdolphin/chatbot");
    expect(probe.options.headers.Authorization).toBe("Bearer fixture-account-b");
    expect(JSON.parse(probe.options.body)).toEqual({ input: "Hello" });
    const fetcher = vi.fn().mockResolvedValueOnce(json({ detail: "bad key" }, 401));
    expect(await probeRegistryProvider("nlpcloud", "fixture-account-b", fetcher)).toMatchObject({ valid: false, status: 401 });
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
  });
  it.each([401, 403, 429, 500])("preserves upstream HTTP %s failures", async (status) => {
    transport.mockResolvedValueOnce(json({ detail: "upstream rejected request" }, status));
    const { response } = await execute();
    expect(response.status).toBe(status);
    expect((await response.json()).error.message).toContain("upstream rejected request");
  });
  it("redacts selected credentials from errors and keeps account headers isolated", async () => {
    transport.mockResolvedValueOnce(json({ detail: "Rejected fixture-account-a" }, 403)).mockResolvedValueOnce(json({ response: "ok" }));
    const failure = await execute();
    expect(JSON.stringify(await failure.response.json())).not.toContain("fixture-account-a");
    await execute({ credentials: { apiKey: "fixture-account-b" } });
    expect(transport.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(["Bearer fixture-account-a", "Bearer fixture-account-b"]);
  });
  it("rejects unsupported input without dispatch and treats malformed success as failure", async () => {
    for (const bad of [{ ...body, tools: [{ type: "function" }] }, { messages: [{ role: "user", content: [{ type: "image_url" }] }] }, { messages: [{ role: "assistant", content: "orphan" }] }]) {
      expect((await execute({ body: bad })).response.status).toBe(400);
    }
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValueOnce(json({ unexpected: true }));
    expect((await execute()).response.status).toBe(502);
  });
  it("streams fragmented native text and a split completion marker without losing spaces", async () => {
    transport.mockResolvedValueOnce(new Response(bytes("Hello ", "wor", "ld[DO", "NE]"), { headers: { "Content-Type": "text/event-stream" } }));
    const { response } = await execute({ stream: true });
    expect(JSON.parse(transport.mock.calls[0][1].body).stream).toBe(true);
    const frames = (await response.text()).split("\n\n").filter((s) => s.startsWith("data: {" )).map((s) => JSON.parse(s.slice(6)));
    expect(frames.map((f) => f.choices[0].delta.content || "").join("")).toBe("Hello world");
    expect(frames.at(-1).choices[0].finish_reason).toBe("stop");
  });
  it("fails a truncated stream instead of reporting success", async () => {
    transport.mockResolvedValueOnce(nativeStream(bytes("partial")));
    const { response } = await execute({ stream: true });
    await expect(response.text()).rejects.toThrow("ended before completion");
  });
});

describe("NLP Cloud quota dispatch", () => {
  it.each([
    ["JSON", false, () => json({ response: "Hello" }), true],
    ["native SSE", true, () => nativeStream(bytes("Hello", "[DO", "NE]")), true],
    ["HTTP error", false, () => json({ detail: "failed" }, 500), false],
    ["malformed JSON shape", false, () => json({ response: " " }), false],
    ["truncated SSE", true, () => nativeStream(bytes("Hello")), false],
    ["embedded marker", true, () => nativeStream(bytes("Hello[DONE]", " more text")), false],
    ["empty SSE", true, () => nativeStream(bytes(" [DONE]")), false],
    ["unexpected stream type", true, () => new Response("Hello[DONE]"), false],
    ["stream transport error", true, () => nativeStream(new ReadableStream({
      pull(controller) { controller.error(new Error("fixture transport failure")); },
    })), false],
  ])("settles quota exactly once through chatCore for %s", async (_name, stream, upstream, success) => {
    const ticket = quotaTicket("gateway-reservation");
    const quotaReservation = { ...ticket, beginDispatch: vi.fn().mockResolvedValue(ticket) };
    transport.mockResolvedValueOnce(upstream());

    const result = await handleChatCore(chatOptions({ quotaReservation }, stream));
    if (success) {
      expect(result.success).toBe(true);
      const wire = await result.response.text();
      if (stream) {
        const content = wire.split("\n").filter((line) => line.startsWith("data: {"))
          .map((line) => JSON.parse(line.slice(6)).choices[0]?.delta.content ?? "").join("");
        expect(content).toBe("Hello");
      } else {
        const completion = JSON.parse(wire);
        expect(completion.choices[0].message.content).toBe("Hello");
        expect(completion).not.toHaveProperty("usage");
      }
    } else if (result.success) {
      await expect(result.response.text()).rejects.toThrow();
    } else {
      expect(result.response.status).toBeGreaterThanOrEqual(400);
    }
    expect(quotaReservation.beginDispatch).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(ticket.settle).toHaveBeenCalledTimes(1);
    expect(ticket.settle).toHaveBeenCalledWith({ success, reason: success ? "success" : expect.not.stringMatching(/^success$/) });
  });

  it("releases quota when the client cancels before the native terminal", async () => {
    const ticket = quotaTicket("gateway-cancel");
    const quotaReservation = { ...ticket, beginDispatch: vi.fn().mockResolvedValue(ticket) };
    const cancel = vi.fn();
    transport.mockResolvedValueOnce(nativeStream(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("Incomplete answer[DONE]")); },
      cancel,
    })));

    const result = await handleChatCore(chatOptions({ quotaReservation }, true));
    expect(result.success).toBe(true);
    const reader = result.response.body.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(quotaReservation.beginDispatch).toHaveBeenCalledTimes(1);
    expect(ticket.settle).toHaveBeenCalledTimes(1);
    expect(ticket.settle).toHaveBeenCalledWith({ success: false, reason: "stream_cancel" });
  });

  it("denies a local quota request without sending anything upstream", async () => {
    const denial = new QuotaDispatchUnavailableError("capacity_exhausted");
    const beginQuotaDispatch = vi.fn(async () => { throw denial; });

    await expect(runWithProviderAttemptContext(null, () => execute(), { beginQuotaDispatch }))
      .rejects.toBe(denial);

    expect(transport).not.toHaveBeenCalled();
    expect(beginQuotaDispatch).toHaveBeenCalledTimes(1);
  });

  it("reports local quota unavailability through chatCore without sending", async () => {
    const quota = {
      tracked: true,
      beginDispatch: vi.fn(async () => { throw new QuotaDispatchUnavailableError("capacity_exhausted"); }),
      heartbeat: vi.fn(),
      settle: vi.fn(async () => ({ changed: true })),
    };

    const result = await handleChatCore(chatOptions({ quotaReservation: quota }));

    expect(result).toMatchObject({
      success: false,
      status: 503,
      quotaCapacityUnavailable: true,
      quotaReason: "capacity_exhausted",
    });
    expect(transport).not.toHaveBeenCalled();
    expect(quota.beginDispatch).toHaveBeenCalledTimes(1);
    expect(quota.settle).not.toHaveBeenCalled();
  });

  it("keeps the dispatch ticket on the shaped JSON success response", async () => {
    const ticket = quotaTicket("reservation-json");
    const upstream = json({ response: "Hello" });
    transport.mockResolvedValueOnce(upstream);

    const { response } = await runWithProviderAttemptContext(null, () => execute(), {
      beginQuotaDispatch: async () => ticket,
    });

    expect(await settleProviderAttemptDispatch(response, { success: true, reason: "success" })).toEqual({ changed: true });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
    expect(ticket.settle).toHaveBeenCalledWith({ success: true, reason: "success" });
    // The physical upstream response no longer owns the ticket.
    expect(await settleProviderAttemptDispatch(upstream, { success: true, reason: "success" })).toEqual({ changed: false });
  });

  it("keeps the dispatch ticket on the shaped SSE response", async () => {
    const ticket = quotaTicket("reservation-sse");
    const upstream = new Response(bytes("Hello [DONE]"), { headers: { "Content-Type": "text/event-stream" } });
    transport.mockResolvedValueOnce(upstream);

    const { response } = await runWithProviderAttemptContext(null, () => execute({ stream: true }), {
      beginQuotaDispatch: async () => ticket,
    });

    expect(await settleProviderAttemptDispatch(response, { success: true, reason: "success" })).toEqual({ changed: true });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
    expect(ticket.settle).toHaveBeenCalledWith({ success: true, reason: "success" });
    expect(await settleProviderAttemptDispatch(upstream, { success: true, reason: "success" })).toEqual({ changed: false });
  });

  it("keeps the dispatch ticket on a provider HTTP failure so it is released, not committed", async () => {
    const ticket = quotaTicket("reservation-http-error");
    const upstream = json({ detail: "upstream rejected request" }, 429);
    transport.mockResolvedValueOnce(upstream);

    const { response } = await runWithProviderAttemptContext(null, () => execute(), {
      beginQuotaDispatch: async () => ticket,
    });

    expect(response.status).toBe(429);
    expect(await settleProviderAttemptDispatch(response, { success: false, reason: "fallback" })).toEqual({ changed: true });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
    expect(ticket.settle).toHaveBeenCalledWith({ success: false, reason: "fallback" });
  });

  it("keeps the dispatch ticket on a malformed provider response", async () => {
    const ticket = quotaTicket("reservation-malformed");
    const upstream = json({ unexpected: true });
    transport.mockResolvedValueOnce(upstream);

    const { response } = await runWithProviderAttemptContext(null, () => execute(), {
      beginQuotaDispatch: async () => ticket,
    });

    expect(response.status).toBe(502);
    expect(await settleProviderAttemptDispatch(response, { success: false, reason: "upstream_error" })).toEqual({ changed: true });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
    expect(ticket.settle).toHaveBeenCalledWith({ success: false, reason: "upstream_error" });
  });

  it("settles the returned response and body exactly once on fallback", async () => {
    const ticket = quotaTicket("reservation-fallback");
    transport.mockResolvedValueOnce(json({ response: "Hello" }));

    const { response } = await runWithProviderAttemptContext(null, () => execute(), {
      beginQuotaDispatch: async () => ticket,
    });

    expect(await settleProviderAttemptDispatch(response.body, { success: false, reason: "fallback" })).toEqual({ changed: true });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
    expect(ticket.settle).toHaveBeenCalledWith({ success: false, reason: "fallback" });
    expect(await settleProviderAttemptDispatch(response, { success: false, reason: "fallback" })).toEqual({ changed: false });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
  });
});
