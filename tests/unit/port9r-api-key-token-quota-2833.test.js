/**
 * Port of decolua/9router #2833: lifetime token quotas reserve in-flight
 * tokens atomically, cap the output allowance to what remains, and release
 * the reservation when the response finishes, is cancelled or fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const committed = new Map();
vi.mock("@/lib/db/driver.js", () => ({
  getAdapterSync: () => ({
    get: (_sql, [apiKeyId]) => (committed.has(apiKeyId) ? { totalTokens: committed.get(apiKeyId) } : undefined),
  }),
}));

const {
  reserveLifetimeTokens,
  releaseLifetimeTokens,
  getReservedTokens,
  holdReservationForResponse,
  __resetLifetimeTokenReservationsForTests,
} = await import("@/lib/apiKeyTokenReservations.js");

const key = (maxTokens, id = "key-1") => ({ id, key: "sk-secret", isActive: true, policy: { maxTokens } });
const chat = (extra = {}) => ({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }], ...extra });
const req = () => new Request("http://localhost/v1/chat/completions", { method: "POST" });

beforeEach(() => {
  committed.clear();
  __resetLifetimeTokenReservationsForTests();
});

describe("API key lifetime token reservations (#2833)", () => {
  it("ignores keys without a lifetime token cap", () => {
    const body = chat();
    const result = reserveLifetimeTokens(req(), { id: "k", policy: null }, body);
    expect(result).toEqual({ ok: true, body, tokens: 0 });
    expect(getReservedTokens("k")).toBe(0);
  });

  it("caps the output allowance to the remaining quota", () => {
    committed.set("key-1", 900);
    const result = reserveLifetimeTokens(req(), key(1000), chat({ max_tokens: 5000 }));
    expect(result.ok).toBe(true);
    expect(result.body.max_tokens).toBeLessThan(100);
    expect(result.tokens).toBe(100);
    expect(getReservedTokens("key-1")).toBe(100);
  });

  it("adds max_tokens when the request has none, and keeps a smaller request untouched", () => {
    const capped = reserveLifetimeTokens(req(), key(1000), chat());
    expect(capped.body.max_tokens).toBeGreaterThan(0);
    __resetLifetimeTokenReservationsForTests();
    const body = chat({ max_completion_tokens: 10 });
    expect(reserveLifetimeTokens(req(), key(1000), body).body).toBe(body);
  });

  it("uses max_output_tokens for Responses bodies", () => {
    const result = reserveLifetimeTokens(req(), key(1000), { model: "m", input: "hello" });
    expect(result.body.max_output_tokens).toBeGreaterThan(0);
    expect(result.body.max_tokens).toBeUndefined();
  });

  it("denies concurrent requests once in-flight reservations fill the cap", () => {
    const first = reserveLifetimeTokens(req(), key(1000), chat());
    expect(first.ok).toBe(true);
    const second = reserveLifetimeTokens(req(), key(1000), chat());
    expect(second).toMatchObject({ ok: false, limit: 1000 });
    expect(second.used).toBe(1000);
  });

  it("denies when committed usage leaves no room for the prompt", () => {
    committed.set("key-1", 999);
    expect(reserveLifetimeTokens(req(), key(1000), chat()).ok).toBe(false);
  });

  it("excludes the owning request when counting reservations, and release is idempotent", () => {
    const request = req();
    reserveLifetimeTokens(request, key(1000), chat({ max_tokens: 50 }));
    expect(getReservedTokens("key-1", { exclude: request })).toBe(0);
    expect(getReservedTokens("key-1")).toBeGreaterThan(0);
    releaseLifetimeTokens(request);
    releaseLifetimeTokens(request);
    expect(getReservedTokens("key-1")).toBe(0);
  });

  it("expires a reservation whose lease is never released", () => {
    const now = Date.now();
    reserveLifetimeTokens(req(), key(1000), chat(), now);
    expect(getReservedTokens("key-1", { now: now + 31 * 60 * 1000 })).toBe(0);
  });

  it("releases immediately for error responses", () => {
    const request = req();
    reserveLifetimeTokens(request, key(1000), chat());
    const response = new Response("nope", { status: 429 });
    expect(holdReservationForResponse(request, response)).toBe(response);
    expect(getReservedTokens("key-1")).toBe(0);
  });

  it("holds the reservation until a streamed body is fully read", async () => {
    const request = req();
    reserveLifetimeTokens(request, key(1000), chat());
    const wrapped = holdReservationForResponse(request, new Response("data: done\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }));
    expect(wrapped.headers.get("content-type")).toBe("text/event-stream");
    expect(getReservedTokens("key-1")).toBeGreaterThan(0);
    expect(await wrapped.text()).toBe("data: done\n\n");
    expect(getReservedTokens("key-1")).toBe(0);
  });

  it("releases when the client cancels the stream", async () => {
    const request = req();
    reserveLifetimeTokens(request, key(1000), chat());
    const source = new ReadableStream({ pull() {} });
    const wrapped = holdReservationForResponse(request, new Response(source, { status: 200 }));
    await wrapped.body.cancel("client gone");
    expect(getReservedTokens("key-1")).toBe(0);
  });
});
