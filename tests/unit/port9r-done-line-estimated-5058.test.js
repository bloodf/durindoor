// decolua/9router #5058: the DONE log line marks an estimated usage so a guessed count
// is not read as a measured one. mergeUsage/canonicalizeUsage already keep the estimate
// below provider-reported usage in DurinDoor.
import { describe, it, expect } from "vitest";
import { formatDoneLine } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { mergeUsage } from "../../open-sse/utils/usageTracking.js";

describe("formatDoneLine marks estimated usage", () => {
  it("flags an estimated usage", () => {
    const line = formatDoneLine({ usage: { prompt_tokens: 150405, completion_tokens: 10, estimated: true }, latency: { total: 120, ttft: 30 } });
    expect(line).toContain("(estimated)");
    expect(line).toContain("IN 150405");
  });

  it("leaves a provider-reported usage unmarked", () => {
    const line = formatDoneLine({ usage: { prompt_tokens: 1500, completion_tokens: 20, cached_tokens: 1200 }, latency: { total: 120, ttft: 30 } });
    expect(line).not.toContain("estimated");
  });
});

describe("mergeUsage: an estimate never outranks provider usage", () => {
  it("keeps the real prompt tokens when a larger estimate arrives first or last", () => {
    const estimate = { prompt_tokens: 4502424, completion_tokens: 1024, estimated: true };
    const real = { prompt_tokens: 151674, completion_tokens: 1024, cached_tokens: 150144 };
    expect(mergeUsage(estimate, real).prompt_tokens).toBe(151674);
    expect(mergeUsage(real, estimate).prompt_tokens).toBe(151674);
  });
});
