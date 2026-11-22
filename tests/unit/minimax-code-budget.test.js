import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// MiniMax Code gateway budgets (#2034): input ceiling, context window, default max tokens,
// whole-call time budget and the single retry with backoff. Closed mocks only: the gateway is a
// synthetic fetch, and the token is a placeholder that MiniMax never issued.
const GATEWAY_URL = "https://agent.minimax.io/mavis/api/v1/llm/v1/messages";
const TOKEN = "mmc_synthetic_access_budget";

let root, MinimaxCodeExecutor, budget;
let calls;
let script; // one entry per gateway call: a status, or "network", or "hang"; the last one repeats

const ok = () => Response.json({ id: "msg_synthetic", type: "message", role: "assistant", model: "MiniMax-M3", content: [{ type: "text", text: "hello" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } });
const errorOf = (status) => new Response(JSON.stringify({ type: "error", error: { type: status === 429 ? "rate_limit_error" : "api_error", message: `synthetic ${status}` } }), { status, headers: { "content-type": "application/json" } });

const gateway = async (url, init = {}) => {
  if (String(url) !== GATEWAY_URL) throw new Error(`unexpected mocked URL ${url}`);
  calls.push({ body: JSON.parse(init.body), at: Date.now() });
  const step = script[Math.min(calls.length - 1, script.length - 1)];
  if (step === "network") throw new TypeError("fetch failed");
  if (step === "hang") {
    return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  }
  return step === 200 ? ok() : errorOf(step);
};

const credentials = { accessToken: TOKEN, providerSpecificData: { enableSessionDispatch: true, region: "en" } };
const run = (extra = {}, { executor = new MinimaxCodeExecutor({ retryBaseMs: 1 }), model = "MiniMax-M3" } = {}) =>
  executor.execute({ model, body: { model, messages: [{ role: "user", content: "ping" }], ...extra }, stream: false, credentials });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-code-budget-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data")); vi.stubEnv("HOME", path.join(root, "home"));
  for (const key of ["MINIMAX_CODE_MAX_TOKENS", "MINIMAX_CODE_CONTEXT_WINDOW", "MINIMAX_CODE_MAX_INPUT_TOKENS", "MINIMAX_CODE_GATEWAY_TIMEOUT_MS", "MINIMAX_CODE_GATEWAY_RETRIES"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  vi.resetModules();
  calls = []; script = [200];
  vi.stubGlobal("fetch", vi.fn(gateway));
  ({ MinimaxCodeExecutor } = await import("../../open-sse/executors/minimax-code.js"));
  budget = await import("../../open-sse/services/minimaxCodeBudget.js");
}, 60000);

afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true });
});

const refusal = async (result) => (await result.response.json()).error;

describe("MiniMax Code default max tokens", () => {
  it("fills 8192 when the request carries none, and keeps the request's own value", async () => {
    expect((await run()).response.status).toBe(200);
    expect(calls[0].body.max_tokens).toBe(8192);
    await run({ max_tokens: 321 });
    expect(calls[1].body.max_tokens).toBe(321);
  });

  it("is configurable with MINIMAX_CODE_MAX_TOKENS, and a bad value falls back to 8192", async () => {
    vi.stubEnv("MINIMAX_CODE_MAX_TOKENS", "4096");
    await run();
    expect(calls[0].body.max_tokens).toBe(4096);
    await run({ max_tokens: 100 });
    expect(calls[1].body.max_tokens).toBe(100);
    vi.stubEnv("MINIMAX_CODE_MAX_TOKENS", "-5");
    await run();
    expect(calls[2].body.max_tokens).toBe(8192);
  });
});

describe("MiniMax Code context window", () => {
  it("asks for no window by default and only the catalog window (512000) narrows it", async () => {
    await run();
    expect(calls[0].body).not.toHaveProperty("context_window");
    vi.stubEnv("MINIMAX_CODE_CONTEXT_WINDOW", "512000");
    await run();
    expect(calls[1].body.context_window).toBe(512000);
    vi.stubEnv("MINIMAX_CODE_CONTEXT_WINDOW", "200000"); // neither window: a typo cannot ask for one the model lacks
    await run();
    expect(calls[2].body).not.toHaveProperty("context_window");
  });
});

describe("MiniMax Code input-size ceiling", () => {
  const latin = (tokens) => "a".repeat(tokens * 3);

  it("refuses an oversized request with 413 before any gateway call", async () => {
    const result = await run({ messages: [{ role: "user", content: latin(1_000_100) }] });
    expect(result.response.status).toBe(413);
    const error = await refusal(result);
    expect(error.code).toBe("context_length_exceeded");
    expect(error.message).toMatch(/too large for the managed gateway transport.*limit 1000000/);
    expect(calls).toHaveLength(0);
  });

  it("lets a request under the ceiling through", async () => {
    expect((await run({ messages: [{ role: "user", content: latin(900_000) }] })).response.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("counts the system prompt and the tool catalog, and weighs CJK per character", async () => {
    vi.stubEnv("MINIMAX_CODE_MAX_INPUT_TOKENS", "1000");
    expect((await run({ system: latin(1500) })).response.status).toBe(413);
    expect((await run({ tools: [{ name: "t", description: latin(1500), input_schema: { type: "object" } }] })).response.status).toBe(413);
    expect((await run({ messages: [{ role: "user", content: "中".repeat(1100) }] })).response.status).toBe(413);
    expect((await run({ messages: [{ role: "user", content: latin(100) }] })).response.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("is lowered by MINIMAX_CODE_MAX_INPUT_TOKENS and cannot be raised above the window", async () => {
    vi.stubEnv("MINIMAX_CODE_MAX_INPUT_TOKENS", "100");
    const small = await run({ messages: [{ role: "user", content: latin(200) }] });
    expect(small.response.status).toBe(413);
    expect((await refusal(small)).message).toContain("limit 100)");
    vi.stubEnv("MINIMAX_CODE_MAX_INPUT_TOKENS", "50000000");
    expect((await run({ messages: [{ role: "user", content: latin(1_000_100) }] })).response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("follows the narrowed 512000 window", async () => {
    const body = { messages: [{ role: "user", content: latin(600_000) }] };
    expect((await run(body)).response.status).toBe(200);
    vi.stubEnv("MINIMAX_CODE_CONTEXT_WINDOW", "512000");
    const result = await run(body);
    expect(result.response.status).toBe(413);
    expect((await refusal(result)).message).toContain("limit 512000");
    expect(calls).toHaveLength(1);
  });
});

describe("MiniMax Code call budget", () => {
  it("answers 500 (not a model outage) when the whole call outlives MINIMAX_CODE_GATEWAY_TIMEOUT_MS", async () => {
    vi.stubEnv("MINIMAX_CODE_GATEWAY_TIMEOUT_MS", "40");
    script = ["hang"];
    const startedAt = Date.now();
    const result = await run({}, { executor: new MinimaxCodeExecutor({ retryBaseMs: 1 }) });
    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(result.response.status).toBe(500);
    const error = await refusal(result);
    expect(error.code).toBe("gateway_timeout");
    expect(error.message).toContain("timed out after 40 ms");
  });

  it("defaults to 100000 ms, and a zero, negative or non-numeric value falls back to it", () => {
    expect(budget.resolveMinimaxCodeTimeoutMs({})).toBe(100_000);
    for (const bad of ["0", "-1", "soon", ""]) expect(budget.resolveMinimaxCodeTimeoutMs({ MINIMAX_CODE_GATEWAY_TIMEOUT_MS: bad })).toBe(100_000);
    expect(budget.resolveMinimaxCodeTimeoutMs({ MINIMAX_CODE_GATEWAY_TIMEOUT_MS: "2500" })).toBe(2500);
  });

  it("does not cut a call that answers inside the budget", async () => {
    vi.stubEnv("MINIMAX_CODE_GATEWAY_TIMEOUT_MS", "2000");
    expect((await run()).response.status).toBe(200);
  });
});

describe("MiniMax Code retry with backoff", () => {
  it.each([429, 500, 503])("retries a %i once and returns the answer of the retry", async (status) => {
    script = [status, 200];
    const result = await run();
    expect(result.response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("retries a dropped connection once", async () => {
    script = ["network", 200];
    expect((await run()).response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it.each([[429, 429], [500, 500], [503, 503]])("retries a %i once, then surfaces the error with its own status", async (status, expected) => {
    script = [status];
    const result = await run();
    expect(calls).toHaveLength(2);
    expect(result.response.status).toBe(expected);
    expect((await refusal(result)).message).toContain(`synthetic ${status}`);
  });

  it.each([400, 403, 404, 422])("never retries a %i", async (status) => {
    script = [status];
    const result = await run();
    expect(calls).toHaveLength(1);
    expect(result.response.status).toBe(status);
  });

  it("is configurable with MINIMAX_CODE_GATEWAY_RETRIES: 0 turns it off, 2 allows two, a typo keeps one", async () => {
    script = [503];
    vi.stubEnv("MINIMAX_CODE_GATEWAY_RETRIES", "0");
    await run();
    expect(calls).toHaveLength(1);
    calls = [];
    vi.stubEnv("MINIMAX_CODE_GATEWAY_RETRIES", "2");
    await run();
    expect(calls).toHaveLength(3);
    calls = [];
    vi.stubEnv("MINIMAX_CODE_GATEWAY_RETRIES", "many");
    await run();
    expect(calls).toHaveLength(2);
    expect(budget.resolveMinimaxCodeRetries({ MINIMAX_CODE_GATEWAY_RETRIES: "99" })).toBe(budget.MINIMAX_CODE_MAX_RETRIES);
    expect(budget.resolveMinimaxCodeRetries({})).toBe(1);
  });

  it("waits a backoff between the attempts, growing exponentially and capped", async () => {
    script = [503];
    vi.stubEnv("MINIMAX_CODE_GATEWAY_RETRIES", "2");
    await run({}, { executor: new MinimaxCodeExecutor({ retryBaseMs: 40 }) });
    expect(calls).toHaveLength(3);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(35);
    expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(70);
    expect([1, 2, 3, 10].map((attempt) => budget.minimaxCodeBackoffMs(attempt))).toEqual([1000, 2000, 4000, 30_000]);
  });

  it("does not spend a retry on a request the ceiling refused", async () => {
    script = [503];
    const result = await run({ messages: [{ role: "user", content: "a".repeat(4_000_000) }] });
    expect(result.response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});
