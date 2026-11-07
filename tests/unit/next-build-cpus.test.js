import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const mdxModule = createRequire(new URL("../../website/next.config.mjs", import.meta.url))
  .resolve("fumadocs-mdx/next");

const mocks = vi.hoisted(() => ({
  availableParallelism: vi.fn(),
  withMDX: vi.fn((config) => config),
}));

vi.mock("node:os", async (importOriginal) => ({
  ...await importOriginal(),
  availableParallelism: mocks.availableParallelism,
}));
beforeEach(() => {
  vi.stubEnv("CIRCLE_NODE_TOTAL", "");
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock(mdxModule, () => ({ createMDX: () => mocks.withMDX }));
});

afterEach(() => vi.unstubAllEnvs());

describe.each([
  ["root", () => import("../../next.config.mjs")],
  ["website", () => import("../../website/next.config.mjs")],
])("%s build CPU allowance", (name, loadConfig) => {
  it.each([
    [24, "3", 2],
    [1, "3", 1],
    [2, "10", 1],
    [10, "invalid", 9],
    [10, "0", 9],
  ])("bounds %i affinity CPUs by CI budget %s to %i workers", async (affinity, budget, expected) => {
    mocks.availableParallelism.mockReturnValue(affinity);
    vi.stubEnv("CIRCLE_NODE_TOTAL", budget);
    const { default: config } = await loadConfig();
    expect(config.experimental.cpus).toBe(expected);
  });

  it.each([[1, 1], [2, 1], [10, 9]])(
    "uses %i effective CPUs to select %i workers",
    async (effectiveCpus, expectedWorkers) => {
      mocks.availableParallelism.mockReturnValue(effectiveCpus);
      const { default: config } = await loadConfig();
      expect(config.experimental.cpus).toBe(expectedWorkers);
      if (name === "website") expect(mocks.withMDX).toHaveBeenCalledWith(config);
    },
  );
});
