import { afterEach, describe, expect, it, vi } from "vitest";

const usage = {
  prompt_tokens: 10,
  completion_tokens: 5,
  cache_read_input_tokens: 7,
  cache_creation_input_tokens: 3,
  reasoning_tokens: 4,
  estimated: true,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("verbose usage logging", () => {
  it("keeps cache and reasoning fields green after the yellow estimate", async () => {
    vi.stubEnv("LOG_USAGE_VERBOSE", "1");
    const { logUsage, COLORS } = await import("../../open-sse/utils/usageTracking.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const before = structuredClone(usage);
    logUsage("openai", usage, null, "123456789");
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0].endsWith(
      `${COLORS.green}[USAGE] OPENAI | in=10 | out=5 | account=12345678... ${COLORS.yellow}(estimated)${COLORS.green} | cache_read=7 | cache_create=3 | reasoning=4${COLORS.reset}`
    )).toBe(true);
    expect(usage).toEqual(before);
  });

  it("does not log when verbose usage is disabled", async () => {
    vi.stubEnv("LOG_USAGE_VERBOSE", "0");
    const { logUsage } = await import("../../open-sse/utils/usageTracking.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logUsage("openai", usage);
    expect(log).not.toHaveBeenCalled();
  });

  it("preserves the plain text when color codes are disabled", async () => {
    vi.stubEnv("LOG_USAGE_VERBOSE", "1");
    const { logUsage, COLORS } = await import("../../open-sse/utils/usageTracking.js");
    const original = { ...COLORS };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const color of Object.keys(COLORS)) COLORS[color] = "";
      logUsage("openai", usage);
      expect(log.mock.calls[0][0]).toMatch(/\[USAGE\] OPENAI \| in=10 \| out=5 \| account=unknown \(estimated\) \| cache_read=7 \| cache_create=3 \| reasoning=4$/);
    } finally {
      Object.assign(COLORS, original);
    }
  });
});
