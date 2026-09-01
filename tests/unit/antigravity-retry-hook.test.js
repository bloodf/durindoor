// Guards D3: antigravity 429/503 retry merged into base via computeRetryDelay hook.
import { describe, it, expect } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";

const MAX = 10000;
function res(status, headers = {}, body = null) {
  return {
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    clone: () => ({ text: async () => (body == null ? "" : JSON.stringify(body)) }),
  };
}

describe("antigravity computeRetryDelay hook (D3)", () => {
  const ag = new AntigravityExecutor();

  it("uses Retry-After header (seconds → ms) when within cap", async () => {
    expect(await ag.computeRetryDelay(res(429, { "retry-after": "5" }), 1)).toBe(5000);
  });

  it("vetoes (false) when Retry-After exceeds cap", async () => {
    expect(await ag.computeRetryDelay(res(429, { "retry-after": "60" }), 1)).toBe(false);
  });

  it("parses retry time from error body when no header", async () => {
    const r = res(429, {}, { error: { message: "quota will reset after 3s" } });
    expect(await ag.computeRetryDelay(r, 1)).toBe(3000);
  });

  it("exponential backoff for 429 when no retry info", async () => {
    expect(await ag.computeRetryDelay(res(429), 1)).toBe(Math.min(1000 * 2 ** 1, MAX));
    expect(await ag.computeRetryDelay(res(429), 3)).toBe(Math.min(1000 * 2 ** 3, MAX));
  });

  it("aborts a stalled 429 retry-body inspection", async () => {
    const response = new Response(new ReadableStream({
      pull: () => new Promise(() => {}),
    }), { status: 429 });
    const controller = new AbortController();
    const pending = ag.computeRetryDelay(response, 1, 0, {
      signal: controller.signal,
      maxBytes: 64 * 1024,
      timeoutMs: 1_000,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not parse retry hints beyond the bounded 429 body limit", async () => {
    const response = new Response(
      `${"x".repeat(70 * 1024)} retry after 1 second`,
      { status: 429 },
    );
    await expect(ag.computeRetryDelay(response, 1, 0, {
      maxBytes: 64 * 1024,
      timeoutMs: 1_000,
    })).resolves.toBe(2000);
  });

  it("503 without retry info → transient backoff", async () => {
    expect(await ag.computeRetryDelay(res(503), 1)).toBe(2000);
  });

  it("does not retry Antigravity capacity on the same account", async () => {
    const r = res(503, {}, {
      error: {
        reason: "MODEL_CAPACITY_EXHAUSTED",
        message: "No capacity available for model claude-opus-4-6-thinking on the server",
      },
    });
    expect(await ag.computeRetryDelay(r, 1)).toBe(false);
  });

  it("retries Antigravity agent terminated body even when status is not 429", async () => {
    const r = res(500, {}, { error: { message: "Agent execution terminated due to error" } });
    expect(await ag.computeRetryDelay(r, 1)).toBe(2000);
  });

  it("retries high traffic body", async () => {
    const r = res(500, {}, { error: { message: "Our servers are experiencing high traffic" } });
    expect(await ag.computeRetryDelay(r, 2)).toBe(4000);
  });

  it("does not retry non-transient 400 errors", async () => {
    const r = res(400, {}, { error: { message: "Invalid request" } });
    expect(await ag.computeRetryDelay(r, 1)).toBe(false);
  });

  it("keeps colliding sanitized tool names distinct while deduplicating exact repeats", () => {
    const out = ag.transformRequest("claude-opus-4-6-thinking", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{ functionDeclarations: [
          { name: "read/file", parameters: { type: "object", properties: {} } },
          { name: "read file", parameters: { type: "object", properties: {} } },
          { name: "read/file", parameters: { type: "object", properties: {} } },
        ] }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const names = out.request.tools[0].functionDeclarations.map(fn => fn.name);
    expect(new Set(names).size).toBe(2);
    expect(names.length).toBe(2);
    expect(names.every((name) => /^read_file_[a-f0-9]{20}$/.test(name))).toBe(true);
  });

  it("registry uses the official IDE cloudcode host and user agent", () => {
    expect(antigravity.transport.baseUrls).toEqual(["https://cloudcode-pa.googleapis.com"]);
    expect(antigravity.transport.headers["User-Agent"]).toBe("antigravity/ide/2.5.5 darwin/arm64");
  });

  it("buildHeaders matches official IDE stream headers", () => {
    ag._lastSessionId = "sess-123";
    const h = ag.buildHeaders({ accessToken: "tok" }, true);
    expect(h["User-Agent"]).toBe("antigravity/ide/2.5.5 darwin/arm64");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["Authorization"]).toBe("Bearer tok");
    expect(h).not.toHaveProperty("X-Machine-Session-Id");
    expect(h).not.toHaveProperty("x-request-source");
    expect(h).not.toHaveProperty("Accept");
  });

  it("transforms chat requests with official IDE requestId shape and 64000 token cap", () => {
    const out = ag.transformRequest("claude-opus-4-6-thinking", {
      request: {
        contents: [
          { role: "user", parts: [{ text: "hi" }] },
          { role: "model", parts: [{ text: "hello" }] },
        ],
        generationConfig: { maxOutputTokens: 90000 },
        sessionId: "-3750763034362895579",
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    expect(out.requestId).toMatch(/^agent\/[0-9a-f-]{36}\/\d{13}\/[0-9a-f-]{36}\/\d+$/);
    expect(out.request.generationConfig.maxOutputTokens).toBe(64000);
  });
});

describe("antigravity parseError quota reset extraction (U-16 #2514)", () => {
  const ag = new AntigravityExecutor();

  it("extracts resetsAtMs from quotaResetTimeStamp (ISO) on 429", () => {
    const ts = new Date(Date.now() + 160 * 3600 * 1000).toISOString();
    const body = JSON.stringify({
      error: { message: "Quota exceeded", details: [{ metadata: { quotaResetTimeStamp: ts } }] },
    });
    const result = ag.parseError({ status: 429 }, body);
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBe(new Date(ts).getTime());
  });

  it("extracts resetsAtMs from quotaResetDelay duration string on 429", () => {
    const now = Date.now();
    const body = JSON.stringify({
      error: { message: "Quota exceeded", details: [{ metadata: { quotaResetDelay: "160h19m55s" } }] },
    });
    const result = ag.parseError({ status: 429 }, body);
    const expected = now + (160 * 3600 + 19 * 60 + 55) * 1000;
    expect(result.resetsAtMs).toBeGreaterThan(expected - 1500);
    expect(result.resetsAtMs).toBeLessThan(expected + 1500);
  });

  it("falls back to base parser for non-429 status", () => {
    const result = ag.parseError({ status: 503 }, "capacity");
    expect(result).toEqual({ status: 503, message: "capacity" });
    expect(result.resetsAtMs).toBeUndefined();
  });

  it("falls back to base parser for malformed body / missing metadata", () => {
    const malformed = ag.parseError({ status: 429 }, "not json{");
    expect(malformed).toEqual({ status: 429, message: "not json{" });
    expect(malformed.resetsAtMs).toBeUndefined();

    const noMeta = ag.parseError(
      { status: 429 },
      JSON.stringify({ error: { message: "quota", details: [{ metadata: {} }] } }),
    );
    expect(noMeta.resetsAtMs).toBeUndefined();
  });
});
