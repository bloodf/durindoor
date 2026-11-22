import { describe, expect, it } from "vitest";
import { parseRateLimitEvidence } from "../../open-sse/utils/error.js";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const parse = (body, provider = "gemini-cli") => parseRateLimitEvidence({
  status: 429, headers: new Headers(), bodyText: JSON.stringify(body), now: NOW, provider,
});
const RETRY = "type.googleapis.com/google.rpc.RetryInfo";
const INFO = "type.googleapis.com/google.rpc.ErrorInfo";

describe("port 9router #1716: Google RPC reset hints", () => {
  it("derives the reset from RetryInfo.retryDelay", () => {
    const evidence = parse({ error: { message: "rate limited", details: [{ "@type": RETRY, retryDelay: "30s" }] } });
    expect(evidence.resetAtMs).toBe(NOW + 30_000);
    expect(evidence.source).toBe("structured_body");
  });

  it("prefers the absolute ErrorInfo quotaResetTimeStamp over RetryInfo", () => {
    const stamp = new Date(NOW + 3_600_000).toISOString();
    const evidence = parse({ error: { message: "x", details: [
      { "@type": RETRY, retryDelay: "5s" },
      { "@type": INFO, metadata: { quotaResetTimeStamp: stamp } },
    ] } });
    expect(evidence.resetAtMs).toBe(NOW + 3_600_000);
  });

  it("ignores a RetryInfo delay above the cooldown cap", () => {
    const evidence = parse({ error: { message: "x", details: [{ "@type": RETRY, retryDelay: "9999h" }] } });
    expect(evidence.resetAtMs).toBeNull();
  });

  it("reads the 'Resets in XhYmZs' message format", () => {
    const evidence = parse({ error: { message: "Quota exhausted. Resets in 133h10m19s" } }, "antigravity");
    expect(evidence.resetAtMs).toBe(NOW + (133 * 3600 + 10 * 60 + 19) * 1000);
  });
});
