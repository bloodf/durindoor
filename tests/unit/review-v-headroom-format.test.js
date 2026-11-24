import { beforeEach, describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { runCompressionSeam } = await import("../../open-sse/handlers/chatCore/compressionHook.js");

describe("headroom stack body format", () => {
  let apply;
  let deps;
  beforeEach(() => {
    apply = vi.fn(async (body) => ({ body, compressed: false }));
    const engine = { id: "headroom", apply, isConfigured: () => true, getConfigSchema: () => [], validateConfig: () => ({ valid: true }) };
    deps = {
      isEngineAvailable: () => true,
      getEngine: () => engine,
      deriveDefaultPlan: () => ({ mode: "stacked", stackedPipeline: [{ engine: "headroom" }] }),
      resolveAdaptivePlan: ({ basePlan }) => basePlan,
      planToEngineIds: () => ["headroom"]
    };
  });

  it("passes Claude format to the headroom adapter", async () => {
    const body = { model: "claude-test", max_tokens: 32, system: "help", messages: [{ role: "user", content: "hello" }] };
    await runCompressionSeam(body, deps, {
      enabled: true,
      engines: { headroom: { enabled: true, url: "https://compress.test" } }
    });
    expect(apply).toHaveBeenCalledWith(body, expect.objectContaining({ config: expect.objectContaining({ format: "claude" }) }));
  });

  it("keeps OpenAI format for an OpenAI body", async () => {
    const body = { model: "gpt-test", messages: [{ role: "user", content: "hello" }] };
    await runCompressionSeam(body, deps, {
      enabled: true,
      engines: { headroom: { enabled: true, url: "https://compress.test" } }
    });
    expect(apply).toHaveBeenCalledWith(body, expect.objectContaining({ config: expect.objectContaining({ format: "openai" }) }));
  });

  it("prefers the explicit Claude format for a minimal ambiguous body", async () => {
    const body = { model: "claude-test", max_tokens: 32, messages: [{ role: "user", content: "hello" }] };
    await runCompressionSeam(body, deps, { enabled: true, applyOpts: { format: FORMATS.CLAUDE } });
    expect(apply).toHaveBeenCalledWith(body, expect.objectContaining({ config: expect.objectContaining({ format: FORMATS.CLAUDE }) }));
  });
});
