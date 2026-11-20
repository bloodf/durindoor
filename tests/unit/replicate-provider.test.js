import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
// The mocked transport keeps the real dispatch wrapper so quota reservations,
// dispatch tickets, and their settlement stay exercised without any network.
vi.mock("open-sse/utils/proxyFetch.js", async (original) => {
  const actual = await original();
  const { runProviderAttemptDispatch } = await import("open-sse/services/providerAttemptContext.js");
  return {
    ...actual,
    proxyAwareFetch: (url, options, proxyOptions) =>
      runProviderAttemptDispatch(() => transport.fetch(url, options, proxyOptions)),
  };
});
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { initTranslators } from "../../open-sse/translator/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import {
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch } from
  "../../open-sse/services/providerAttemptContext.js";
import { QuotaDispatchUnavailableError } from "../../open-sse/services/quota/dispatch.js";

const model = "meta/meta-llama-3-70b-instruct";
const api = "https://api.replicate.com/v1";
const credentials = { apiKey: "synthetic-replicate-key" };
const body = { messages: [{ role: "user", content: "Write a short poem about the weather." }] };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const execute = (overrides = {}) => getExecutor("replicate").execute({ model, body, stream: false, credentials, ...overrides });
const withQuota = (beginQuotaDispatch, run) =>
  runWithProviderAttemptContext(() => Date.now(), run, { beginQuotaDispatch });
const quotaTicket = () => ({
  tracked: true,
  reservationId: "reservation-1",
  heartbeat: vi.fn(),
  settle: vi.fn().mockResolvedValue({ changed: true }),
  release: vi.fn(),
});
const streamEvents = () => new Response(new ReadableStream({ start(controller) {
  for (const part of ["event: output\ndata: Hello\n\n", "event: done\ndata: {}\n\n"]) {
    controller.enqueue(new TextEncoder().encode(part));
  }
  controller.close();
} }));

beforeEach(() => { transport.fetch.mockReset(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network"); })); });
afterEach(() => vi.unstubAllGlobals());

describe("Replicate official text predictions", () => {
  it("validates the key and discovers the documented model through connection plumbing", async () => {
    const validate = vi.fn().mockResolvedValue(json({ username: "fixture" }));
    expect(await probeRegistryProvider("replicate", credentials.apiKey, validate)).toMatchObject({ valid: true });
    expect(validate.mock.calls[0][0]).toBe(`${api}/account`);
    expect(validate.mock.calls[0][1]).toMatchObject({ redirect: "manual", headers: { Authorization: `Bearer ${credentials.apiKey}` } });
    transport.fetch.mockResolvedValueOnce(json({ owner: "meta", name: "meta-llama-3-70b-instruct" }));
    const discovered = await fetchConnectionModels({ id: "fixture", provider: "replicate", ...credentials });
    expect(discovered.models).toEqual([{ id: model, name: "Llama 3 70B Instruct" }]);
    expect(PROVIDER_MODELS.replicate.map((item) => item.id)).toContain(model);
    expect(transport.fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual", headers: { Authorization: `Bearer ${credentials.apiKey}` } });
  });
  it.each([false, true])("routes a chat request through the gateway with stream=%s", async (stream) => {
    await initTranslators();
    transport.fetch.mockResolvedValueOnce(json({ status: "succeeded", output: ["Hello", " there"] }, 201));
    const request = { ...body, model: `replicate/${model}`, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) };
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() };
    const result = await handleChatCore({ body: request, modelInfo: { provider: "replicate", model }, credentials, clientRawRequest: { endpoint: "/v1/chat/completions", body: request, headers: { accept: stream ? "text/event-stream" : "application/json" } }, connectionId: "offline-replicate", log });
    expect(result.success, result.success ? undefined : await result.response.text()).toBe(true);
    const wire = await result.response.text();
    expect(wire).toContain("Hello there");
    expect(wire).not.toContain('"usage"');
    expect(transport.fetch.mock.calls[0][0]).toBe(`${api}/models/${model}/predictions`);
  });
  it("creates and translates the documented synchronous prediction without invented usage", async () => {
    transport.fetch.mockResolvedValueOnce(json({ status: "succeeded", output: ["A sunny ", "day."] }, 201));
    const { response } = await execute();
    expect(transport.fetch.mock.calls[0][0]).toBe(`${api}/models/${model}/predictions`);
    expect(transport.fetch.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "manual", headers: { Prefer: "wait=60", Authorization: `Bearer ${credentials.apiKey}` } });
    expect(JSON.parse(transport.fetch.mock.calls[0][1].body)).toEqual({ input: { prompt: body.messages[0].content } });
    const result = await response.json();
    expect(result.choices[0].message.content).toBe("A sunny day.");
    expect(result).not.toHaveProperty("usage");
  });
  it("polls a pending prediction only at the verified API origin", async () => {
    transport.fetch.mockResolvedValueOnce(json({ status: "starting", urls: { get: `${api}/predictions/fixture` } }, 201));
    transport.fetch.mockResolvedValueOnce(json({ status: "succeeded", output: ["Finished"] }));
    const result = await execute();
    expect((await result.response.json()).choices[0].message.content).toBe("Finished");
    expect(transport.fetch.mock.calls[1][0]).toBe(`${api}/predictions/fixture`);
    expect(transport.fetch.mock.calls[1][1]).toMatchObject({ redirect: "manual", headers: { Authorization: `Bearer ${credentials.apiKey}` } });
  });
  it("relays fragmented native output events and a successful done event", async () => {
    transport.fetch.mockResolvedValueOnce(json({ status: "starting", urls: { stream: "https://streaming.api.replicate.com/v1/predictions/fixture" } }, 201));
    transport.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { for (const part of ["event: output\r", "\ndata: Hello\r\n\r\nevent: output\ndata:  world\n\n", "event: done\ndata: {}\n\n"]) c.enqueue(new TextEncoder().encode(part)); c.close(); } })));
    const { response } = await execute({ stream: true });
    expect(JSON.parse(transport.fetch.mock.calls[0][1].body)).toMatchObject({ stream: true });
    expect(transport.fetch.mock.calls[1][1]).toMatchObject({ redirect: "manual", headers: { Authorization: `Bearer ${credentials.apiKey}` } });
    const wire = await response.text();
    expect(wire).toContain('"content":"Hello"');
    expect(wire).toContain('"content":" world"');
    expect(wire).toContain('"finish_reason":"stop"');
    expect(wire).not.toContain('"usage"');
  });
  it.each(["https://evil.example/predictions/1", "https://streaming.api.replicate.com.evil.example/x", "http://streaming.api.replicate.com/x"])('rejects unexpected stream destination %s', async (url) => {
    transport.fetch.mockResolvedValueOnce(json({ status: "starting", urls: { stream: url } }));
    expect((await execute({ stream: true })).response.status).toBe(502);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects unexpected polling destinations and redirects before forwarding credentials", async () => {
    transport.fetch.mockResolvedValueOnce(json({ status: "starting", urls: { get: "https://evil.example/prediction" } }));
    expect((await execute()).response.status).toBe(502);
    transport.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://evil.example" } }));
    expect((await execute()).response.status).toBe(502);
    expect(transport.fetch).toHaveBeenCalledTimes(2);
  });
  it("surfaces native stream errors and canceled predictions", async () => {
    transport.fetch.mockResolvedValueOnce(json({ status: "starting", urls: { stream: "https://streaming.api.replicate.com/v1/predictions/fixture" } }));
    transport.fetch.mockResolvedValueOnce(new Response('event: done\ndata: {"reason":"canceled"}\n\n'));
    const wire = await (await execute({ stream: true })).response.text();
    expect(wire).toContain('"error"');
    expect(wire).not.toContain('"finish_reason":"stop"');
    transport.fetch.mockResolvedValueOnce(json({ status: "failed", error: "fixture" }));
    expect((await execute()).response.status).toBe(502);
  });
  it("rejects unsupported media, tools, and malformed model IDs without dispatch", async () => {
    expect((await execute({ body: { messages: [{ role: "user", content: [{ type: "image_url", image_url: "https://example.com/a" }] }] } })).response.status).toBe(400);
    expect((await execute({ body: { ...body, tools: [{ type: "function" }] } })).response.status).toBe(400);
    expect((await execute({ model: "../evil" })).response.status).toBe(400);
    expect(transport.fetch).not.toHaveBeenCalled();
  });
});

describe("Replicate quota lifecycle", () => {
  it("refuses a locally denied reservation before any prediction request is sent", async () => {
    const beginQuotaDispatch = vi.fn().mockRejectedValue(new QuotaDispatchUnavailableError("capacity_exhausted"));
    await expect(withQuota(beginQuotaDispatch, () => execute())).rejects.toMatchObject({
      code: "QUOTA_DISPATCH_UNAVAILABLE",
      reason: "capacity_exhausted",
    });
    expect(transport.fetch).not.toHaveBeenCalled();
  });
  it("charges prediction creation only and leaves polling retrieval uncharged", async () => {
    const beginQuotaDispatch = vi.fn().mockResolvedValue(quotaTicket());
    transport.fetch.mockResolvedValueOnce(json({ status: "starting", urls: { get: `${api}/predictions/fixture` } }, 201));
    transport.fetch.mockResolvedValueOnce(json({ status: "succeeded", output: ["Finished"] }));
    await withQuota(beginQuotaDispatch, () => execute());
    expect(beginQuotaDispatch).toHaveBeenCalledTimes(1);
    expect(transport.fetch).toHaveBeenCalledTimes(2);
  });
  it("charges prediction creation only and leaves stream retrieval uncharged", async () => {
    const beginQuotaDispatch = vi.fn().mockResolvedValue(quotaTicket());
    transport.fetch.mockResolvedValueOnce(json({ status: "starting", urls: { stream: "https://streaming.api.replicate.com/v1/predictions/fixture" } }, 201));
    transport.fetch.mockResolvedValueOnce(streamEvents());
    await withQuota(beginQuotaDispatch, () => execute({ stream: true }));
    expect(beginQuotaDispatch).toHaveBeenCalledTimes(1);
    expect(transport.fetch).toHaveBeenCalledTimes(2);
  });
  it("moves the dispatch ticket onto the shaped completion so it settles once", async () => {
    const ticket = quotaTicket();
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    transport.fetch.mockResolvedValueOnce(json({ status: "succeeded", output: ["Hello"] }, 201));
    const out = await withQuota(beginQuotaDispatch, () => execute());
    expect(ticket.settle).not.toHaveBeenCalled();
    expect(await settleProviderAttemptDispatch(out.response, { success: true })).toEqual({ changed: true });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
    expect(await settleProviderAttemptDispatch(out.response, { success: true })).toEqual({ changed: false });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
  });
  it("moves the dispatch ticket onto the streamed completion so it settles once", async () => {
    const ticket = quotaTicket();
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    transport.fetch.mockResolvedValueOnce(json({ status: "starting", urls: { stream: "https://streaming.api.replicate.com/v1/predictions/fixture" } }, 201));
    transport.fetch.mockResolvedValueOnce(streamEvents());
    const out = await withQuota(beginQuotaDispatch, () => execute({ stream: true }));
    expect(ticket.settle).not.toHaveBeenCalled();
    expect(await settleProviderAttemptDispatch(out.response, { success: true })).toEqual({ changed: true });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
    expect(await settleProviderAttemptDispatch(out.response, { success: true })).toEqual({ changed: false });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
  });
  it("moves the dispatch ticket onto a provider failure so it settles once", async () => {
    const ticket = quotaTicket();
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    transport.fetch.mockResolvedValueOnce(json({ status: "failed", error: "fixture" }));
    const out = await withQuota(beginQuotaDispatch, () => execute());
    expect(out.response.status).toBe(502);
    expect(await settleProviderAttemptDispatch(out.response, { success: false, reason: "upstream_error" })).toEqual({ changed: true });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
    expect(await settleProviderAttemptDispatch(out.response, { success: false, reason: "upstream_error" })).toEqual({ changed: false });
    expect(ticket.settle).toHaveBeenCalledTimes(1);
  });
  it("reports a local quota denial as unavailable capacity instead of an upstream failure", async () => {
    await initTranslators();
    const quotaReservation = {
      tracked: true,
      beginDispatch: async () => { throw new QuotaDispatchUnavailableError("capacity_exhausted"); },
      settle: vi.fn(async () => ({ changed: false })),
      heartbeat: vi.fn(),
    };
    const request = { ...body, model: `replicate/${model}` };
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() };
    const result = await handleChatCore({ body: request, modelInfo: { provider: "replicate", model }, credentials, clientRawRequest: { endpoint: "/v1/chat/completions", body: request, headers: { accept: "application/json" } }, connectionId: "offline-replicate", log, quotaReservation });
    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
    expect(result.quotaCapacityUnavailable).toBe(true);
    expect(transport.fetch).not.toHaveBeenCalled();
  });
});
