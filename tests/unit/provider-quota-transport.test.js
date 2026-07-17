import { describe, expect, it, vi } from "vitest";
import {
  classifyQuotaHttpStatus,
  requestQuotaJson,
} from "../../open-sse/services/quota/transport.js";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");
const now = () => NOW;

describe("provider quota transport", () => {
  it.each([
    [200, "success"],
    [204, "success"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [404, "provider_error"],
    [503, "provider_error"],
  ])("maps HTTP %i to %s", (status, outcome) => {
    expect(classifyQuotaHttpStatus(status)).toBe(outcome);
  });

  it("parses one bounded JSON response and forces redirect errors", async () => {
    const fetchImpl = vi.fn(async (_url, options, proxyOptions) => {
      expect(options.redirect).toBe("error");
      expect(proxyOptions).toEqual({ strictProxy: true });
      return new Response(JSON.stringify({ remaining: 0 }), { status: 200 });
    });
    await expect(requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl,
      proxyOptions: { strictProxy: true },
      now,
    })).resolves.toMatchObject({
      ok: true,
      outcome: "success",
      attemptedAt: "2026-01-01T00:00:00.000Z",
      data: { remaining: 0 },
    });
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [500, "provider_error"],
  ])("returns a body-free failure for HTTP %i", async (status, outcome) => {
    const canary = "sk-secret-should-never-escape";
    const result = await requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: async () => new Response(canary, { status }),
      now,
    });
    expect(result).toMatchObject({ ok: false, outcome, retryAt: null });
    expect(JSON.stringify(result)).not.toContain(canary);
  });

  it("parses and bounds Retry-After seconds and dates", async () => {
    const seconds = await requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: async () => new Response("", { status: 429, headers: { "Retry-After": "60" } }),
      now,
    });
    expect(seconds.retryAt).toBe("2026-01-01T00:01:00.000Z");

    const bounded = await requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: async () => new Response("", { status: 429, headers: { "Retry-After": "259200" } }),
      now,
    });
    expect(bounded.retryAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it.each(["", "not-json"])("classifies malformed JSON body %#", async (body) => {
    const result = await requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: async () => new Response(body, { status: 200 }),
      now,
    });
    expect(result).toMatchObject({ ok: false, outcome: "malformed" });
  });

  it("rejects a streamed body above the byte cap before parsing", async () => {
    const result = await requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: async () => new Response(JSON.stringify({ value: "x".repeat(128) }), { status: 200 }),
      maxBytes: 32,
      now,
    });
    expect(result).toMatchObject({ ok: false, outcome: "malformed" });
  });

  it("distinguishes network failure from timeout", async () => {
    const network = await requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: async () => { throw new Error("network canary"); },
      now,
    });
    expect(network).toMatchObject({ ok: false, outcome: "network_error" });
    expect(JSON.stringify(network)).not.toContain("canary");

    const timeout = await requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
      timeoutMs: 5,
      now,
    });
    expect(timeout).toMatchObject({ ok: false, outcome: "timeout" });
  });

  it("bounds a stalled response-body read with the same timeout", async () => {
    const stalled = new ReadableStream({ pull: () => new Promise(() => {}) });

    await expect(requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: async () => new Response(stalled, { status: 200 }),
      timeoutMs: 5,
      now,
    })).resolves.toMatchObject({ ok: false, outcome: "timeout" });
  });

  it("bounds a fetch implementation that ignores its abort signal", async () => {
    await expect(requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: () => new Promise(() => {}),
      timeoutMs: 5,
      now,
    })).resolves.toMatchObject({ ok: false, outcome: "timeout" });
  });

  it("does not await hostile response-body cancellation", async () => {
    const cancel = vi.fn(() => new Promise(() => {}));
    const result = await requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: async () => ({ status: 429, headers: new Headers(), body: { cancel } }),
      timeoutMs: 5,
      now,
    });

    expect(result).toMatchObject({ ok: false, outcome: "rate_limited" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("propagates caller abort without converting or persisting it", async () => {
    const controller = new AbortController();
    const pending = requestQuotaJson({
      url: "https://quota.example.test/v1",
      fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
      signal: controller.signal,
      timeoutMs: 1000,
      now,
    });
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([
    "http://quota.example.test/v1",
    "https://user:password@quota.example.test/v1",
    "not-a-url",
  ])("rejects unsafe endpoint %s without calling fetch", async (url) => {
    const fetchImpl = vi.fn();
    await expect(requestQuotaJson({ url, fetchImpl, now })).resolves.toMatchObject({
      ok: false,
      outcome: "provider_error",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
