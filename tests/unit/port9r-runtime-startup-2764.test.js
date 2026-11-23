import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const state = vi.hoisted(() => ({ initialize: vi.fn() }));
vi.mock("@/shared/services/initializeApp.js", () => ({ initializeApp: state.initialize }));

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  delete globalThis.__appBootstrapPromise;
  state.initialize.mockReset();
});

describe("runtime startup", () => {
  it("loads the real MCP bridge without an alias resolver", () => {
    const require = createRequire(import.meta.url);
    expect(require("../../src/lib/mcp/stdioSseBridge.js").killAllBridges).toBeTypeOf("function");
  });

  it("initializes once and retries after failure", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    delete process.env.DURINDOOR_BUILD;
    delete process.env.npm_lifecycle_event;
    const { bootstrapRuntime } = await import("../../src/shared/services/bootstrap.js");
    state.initialize.mockRejectedValueOnce(new Error("startup failed")).mockResolvedValue();
    await expect(bootstrapRuntime()).rejects.toThrow("startup failed");
    await Promise.all([bootstrapRuntime(), bootstrapRuntime()]);
    expect(state.initialize).toHaveBeenCalledTimes(2);
  });

  it("does not initialize in edge or build contexts", async () => {
    const { bootstrapRuntime } = await import("../../src/shared/services/bootstrap.js");
    process.env.NEXT_RUNTIME = "edge";
    await bootstrapRuntime();
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-build";
    await bootstrapRuntime();
    expect(state.initialize).not.toHaveBeenCalled();
  });
});
