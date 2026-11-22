import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", async () => {
  const { runProviderAttemptDispatch } = await import("../../open-sse/services/providerAttemptContext.js");
  return { proxyAwareFetch: (url, options, proxyOptions) => runProviderAttemptDispatch(() => fetchMock(url, options, proxyOptions)) };
});

import { VertexExecutor } from "../../open-sse/executors/vertex.js";
import { XaiExecutor } from "../../open-sse/executors/xai.js";
import { runWithProviderAttemptContext, isQuotaBearingProviderRequest } from "../../open-sse/services/providerAttemptContext.js";

beforeEach(() => fetchMock.mockReset());

describe("review #2257 executor regressions", () => {
  it.each(["vertex", "vertex-partner"])("dispatches %s through quota accounting and blocks redirects", async (provider) => {
    let quotaReservations = 0;
    fetchMock.mockImplementation(async (_url, options = {}) => {
      if (options.method === "POST") {
        expect(options.redirect).toBe("error");
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(isQuotaBearingProviderRequest()).toBe(true);
      }
      return new Response("{}", { status: 200 });
    });
    const credentials = provider === "vertex-partner"
      ? { apiKey: "vertex-test-key", providerSpecificData: { projectId: "test-project" } }
      : { apiKey: "vertex-test-key" };
    const executor = new VertexExecutor(provider);
    const result = await runWithProviderAttemptContext(() => 123, () => executor.execute({
      model: provider === "vertex" ? "gemini-2.5-flash" : "partner-model",
      body: {}, stream: false, credentials
    }), { beginQuotaDispatch: () => { quotaReservations += 1; return {}; } });
    expect(quotaReservations).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error" });
    expect(result.attemptStartedAt).toBe(123);
  });

  it("strips only an end-anchored xAI effort suffix", () => {
    const output = new XaiExecutor().transformRequest("xai/grok-4-low-high", { model: "grok-4-low-high" });
    expect(output.model).toBe("grok-4-low");
    expect(output.reasoning_effort).toBe("high");
  });

  it("does not retain unreachable Cohere retry or Qwen/Kilo Code refresh branches", async () => {
    const { readFile } = await import("node:fs/promises");
    const [base, defaults] = await Promise.all([
      readFile(new URL("../../open-sse/executors/base.js", import.meta.url), "utf8"),
      readFile(new URL("../../open-sse/executors/default.js", import.meta.url), "utf8")
    ]);
    expect(base).not.toMatch(/this\.provider === ["']cohere["'] && response\.status === 422/);
    expect(defaults).not.toMatch(/qwen:\s*\(\)\s*=>/);
    expect(defaults).not.toMatch(/kilocode:\s*\(\)\s*=>/);
    expect(defaults).not.toMatch(/async refreshKilocode\(/);
  });
});
