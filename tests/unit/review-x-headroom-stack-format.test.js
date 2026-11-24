import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCompressionSeam } from "../../open-sse/handlers/chatCore/compressionHook.js";

describe("headroom stack format and duplicate-stage guard", () => {
  let apply;
  let deps;

  beforeEach(() => {
    apply = vi.fn(async (body) => ({ body, compressed: false }));
    const engine = {
      id: "headroom",
      apply,
      isConfigured: () => true,
      getConfigSchema: () => [],
      validateConfig: () => ({ valid: true })
    };
    deps = {
      isEngineAvailable: () => true,
      getEngine: () => engine,
      deriveDefaultPlan: () => ({ mode: "stacked", stackedPipeline: [{ engine: "headroom" }] }),
      resolveAdaptivePlan: ({ basePlan }) => basePlan,
      planToEngineIds: () => ["headroom"]
    };
  });

  it("passes Claude format through the headroom step config", async () => {
    const body = { model: "claude-test", max_tokens: 32, system: "help", messages: [{ role: "user", content: "hello" }] };
    await runCompressionSeam(body, deps, {
      enabled: true,
      engines: { headroom: { enabled: true, url: "https://compress.test" } }
    });
    expect(apply).toHaveBeenCalledWith(body, expect.objectContaining({
      config: expect.objectContaining({ format: "claude" }),
      stepConfig: expect.objectContaining({ format: "claude" })
    }));
  });

  it("skips headroom when the legacy headroom stage already ran", async () => {
    const body = { model: "claude-test", messages: [{ role: "user", content: "already compressed" }] };
    await runCompressionSeam(body, deps, {
      enabled: true,
      applyOpts: { headroomApplied: true },
      engines: { headroom: { enabled: true, url: "https://compress.test" } }
    });
    expect(apply).not.toHaveBeenCalled();
  });
});
