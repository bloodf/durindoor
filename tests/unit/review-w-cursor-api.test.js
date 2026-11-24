import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorApiExecutor } from "../../open-sse/executors/cursor-api.js";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";

const KEY = "crsr_regression_key";
const jwt = (exp = Math.floor(Date.now() / 1000) + 3600) => {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ exp })}.sig`;
};
const ok = (token = jwt()) => new Response(JSON.stringify({ accessToken: token }), { status: 200 });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

afterEach(() => vi.restoreAllMocks());

describe("cursor-api review regressions", () => {
  it("shares a key exchange without sharing callers' abort signals", async () => {
    const gate = deferred();
    let exchangeSignal;
    const executor = new CursorApiExecutor({ fetchImpl: async (_url, init) => {
      exchangeSignal = init.signal;
      await gate.promise;
      return ok();
    } });
    const controller = new AbortController();
    const first = executor.resolveSession(KEY, { signal: controller.signal });
    const second = executor.resolveSession(KEY);
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(exchangeSignal.aborted).toBe(false);
    gate.resolve();
    await expect(second).resolves.toMatchObject({ accessToken: expect.any(String) });
  });

  it("cancels exchange error bodies and replaced chat error bodies", async () => {
    let exchangeCancelled = false;
    const executor = new CursorApiExecutor({ fetchImpl: async () => new Response(new ReadableStream({
      cancel() { exchangeCancelled = true; },
    }), { status: 429, headers: { "retry-after": "2" } }) });
    await expect(executor.resolveSession(KEY)).rejects.toMatchObject({ code: "cursor_api_rate_limited" });
    expect(exchangeCancelled).toBe(true);

    let chatCancelled = false;
    const chatResponse = new Response(new ReadableStream({ cancel() { chatCancelled = true; } }), { status: 401 });
    vi.spyOn(CursorExecutor.prototype, "execute").mockResolvedValue({ response: chatResponse });
    const chatExecutor = new CursorApiExecutor({ fetchImpl: async () => ok() });
    const result = await chatExecutor.execute({
      credentials: { apiKey: KEY, providerSpecificData: { enableSessionDispatch: true } },
    });
    expect(result.response.status).toBe(401);
    expect(chatCancelled).toBe(true);
  });

  it("sweeps expired sessions and caps the cache at 200 entries", async () => {
    let now = 1_800_000_000_000;
    const executor = new CursorApiExecutor({ now: () => now, fetchImpl: async () => ok(jwt(Math.floor(now / 1000) + 3600)) });
    executor.sessions.set("expired", { expiresAt: now - 1 });
    await executor.resolveSession("crsr_new_session");
    expect(executor.sessions.has("expired")).toBe(false);

    for (let index = 0; index < 205; index += 1) {
      await executor.resolveSession(`crsr_cache_${index}`);
    }
    expect(executor.sessions.size).toBe(200);
    now += 1;
  });
});
