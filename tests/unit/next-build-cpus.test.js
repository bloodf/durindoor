import { beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock(mdxModule, () => ({ createMDX: () => mocks.withMDX }));
});

describe.each([
  ["root", () => import("../../next.config.mjs")],
  ["website", () => import("../../website/next.config.mjs")],
])("%s build CPU allowance", (name, loadConfig) => {
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
