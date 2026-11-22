import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";

const executor = new AntigravityExecutor();
async function parse(status, body, headers = {}) {
  return parseUpstreamError(new Response(body, { status, headers }), executor);
}

describe("Antigravity detail-free errors", () => {
  it.each([409, 429])("marks a parsed detail-free %s as request-scoped", async (status) => {
    const result = await parse(status, JSON.stringify({ error: { message: "request rejected" } }));
    expect(result.statusCode).toBe(status);
    expect(result.noQuotaMetadata).toBe(true);
  });

  it("does not classify malformed responses as request-scoped", async () => {
    expect((await parse(429, "{")).noQuotaMetadata).not.toBe(true);
    expect((await parse(409, JSON.stringify({ error: "bad" }))).noQuotaMetadata).not.toBe(true);
  });

  it.each([409, 429])("retains RetryInfo reset for %s", async (status) => {
    const body = JSON.stringify({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7s" }] } });
    const result = await parse(status, body);
    expect(result.noQuotaMetadata).not.toBe(true);
    expect(result.resetsAtMs).toBeGreaterThan(Date.now());
  });

  it("preserves quota signals and retry headers", async () => {
    const quota = JSON.stringify({ error: { details: [{ reason: "QUOTA_EXHAUSTED" }] } });
    expect((await parse(429, quota)).noQuotaMetadata).not.toBe(true);
    const result = await parse(429, JSON.stringify({ error: { message: "busy" } }), { "retry-after": "7" });
    expect(result.noQuotaMetadata).not.toBe(true);
    expect(result.resetsAtMs).toBeGreaterThan(Date.now());
  });
});
