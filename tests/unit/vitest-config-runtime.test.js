import { describe, expect, it } from "vitest";
import config from "../vitest.config.js";

// The full CI checkpoint runs twelve sequential batches under a 300s ceiling each.
// These settings keep that budget reachable without weakening isolation.
describe("vitest runtime configuration", () => {
  it("keeps the fs module cache off", () => {
    // Cache lives in shared (symlinked) tests/node_modules; concurrent runs corrupt it -> "Cannot find module /@fs/...".
    expect(config.test.experimental?.fsModuleCache).not.toBe(true);
  });

  it("keeps the worker cap and per-file isolation intact", () => {
    expect(config.test.maxWorkers).toBe(4);
    expect(config.test.isolate).not.toBe(false);
    expect(config.test.pool ?? "forks").toBe("forks");
  });
});
