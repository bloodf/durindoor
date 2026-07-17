// Regression for upstream decolua/9router#2534 — xAI grok-composer must not
// receive reasoning parameters, and Grok CLI non-reasoning models must not
// emit a `reasoning` block (cli-chat-proxy 400s otherwise).
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";
import { getProviderThinkingLevels } from "../../src/app/(dashboard)/dashboard/providers/[id]/providerThinkingLevels.js";

describe("port #2534: xai strips reasoning params for grok-composer", () => {
  it("drops thinking/reasoning_effort/reasoning on xai grok-composer", () => {
    const body = {
      reasoning_effort: "medium",
      reasoning: { effort: "medium" },
      thinking: { type: "enabled", budget_tokens: 8192 },
      messages: [{ role: "user", content: "hi" }],
    };

    stripUnsupportedParams("xai", "grok-composer-2.5-fast", body);

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.messages).toHaveLength(1);
  });

  it("keeps reasoning params on xai non-composer models (e.g. grok-4)", () => {
    const body = {
      reasoning_effort: "high",
      reasoning: { effort: "high" },
      thinking: { type: "enabled", budget_tokens: 8192 },
      messages: [{ role: "user", content: "hi" }],
    };

    stripUnsupportedParams("xai", "grok-4", body);

    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });

  it("does not strip when provider is not xai", () => {
    const body = { reasoning_effort: "medium", thinking: { type: "enabled" } };
    stripUnsupportedParams("openai", "grok-composer-2.5-fast", body);
    expect(body.reasoning_effort).toBe("medium");
    expect(body.thinking).toEqual({ type: "enabled" });
  });
});

describe("port #2534: capabilities mark grok-composer / grok-build non-reasoning", () => {
  it("getCapabilitiesForModel returns reasoning=false for grok-composer", () => {
    const caps = getCapabilitiesForModel("grok-cli", "grok-composer-2.5-fast");
    expect(caps.reasoning).toBe(false);
    expect(caps.thinkingFormat).toBeNull();
    expect(caps.maxOutput).toBe(30000);
  });

  it("getCapabilitiesForModel returns reasoning=false for grok-build", () => {
    const caps = getCapabilitiesForModel("grok-cli", "grok-build");
    expect(caps.reasoning).toBe(false);
    expect(caps.contextWindow).toBe(512000);
    expect(caps.maxOutput).toBe(30000);
  });

  it("pattern match also works for model ids with suffixes", () => {
    const caps = getCapabilitiesForModel("grok-cli", "x/grok-composer-2.5-fast-v1");
    expect(caps.reasoning).toBe(false);
  });

  it("does not disable reasoning on grok-4.5 (still reasoning)", () => {
    const caps = getCapabilitiesForModel("grok-cli", "grok-4.5");
    expect(caps.reasoning).toBe(true);
  });
});

describe("port #2534: grok-cli executor omits reasoning for non-reasoning models", () => {
  function buildBody(model, extras = {}) {
    return {
      model,
      input: [{ type: "message", role: "user", content: "hi" }],
      ...extras,
    };
  }

  it("does not emit reasoning for grok-composer-2.5-fast", async () => {
    const exec = new GrokCliExecutor();
    const body = buildBody("grok-composer-2.5-fast", { reasoning_effort: "high" });
    const out = await exec.transformRequest("grok-composer-2.5-fast", body, true, { accessToken: "tok", userAgent: "ua" });
    expect(out.reasoning).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("still emits reasoning on grok-4.5 (reasoning=true)", async () => {
    const exec = new GrokCliExecutor();
    const body = buildBody("grok-4.5");
    const out = await exec.transformRequest("grok-4.5", body, true, { accessToken: "tok", userAgent: "ua" });
    expect(out.reasoning).toMatchObject({ effort: expect.any(String) });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("caps tools array at 200", async () => {
    const exec = new GrokCliExecutor();
    const tools = Array.from({ length: 250 }, (_, i) => ({ type: "function", function: { name: `t${i}`, parameters: {} } }));
    const body = buildBody("grok-4.5", { tools });
    const out = await exec.transformRequest("grok-4.5", body, true, { accessToken: "tok", userAgent: "ua" });
    expect(out.tools.length).toBe(200);
  });
});

describe("port #2534: dashboard level picker surfaces \"none\"", () => {
  it("getProviderThinkingLevels returns auto then none before reasoning levels", () => {
    // grok-4.5 has reasoning (gives openai levels incl. "none"); union drives picker.
    const levels = getProviderThinkingLevels({
      providerId: "grok-cli",
      models: [{ id: "grok-4.5" }],
      kiloFreeModels: [],
      customModels: [],
      providerStorageAlias: "grok-cli",
    });
    expect(levels).not.toBeNull();
    expect(levels[0]).toBe("auto");
    expect(levels[1]).toBe("none");
    // Other openai levels follow; "none" must not appear twice.
    expect(levels.filter((l) => l === "none")).toHaveLength(1);
    expect(levels).toContain("high");
  });

  it("returns null when no reasoning model is in the union", () => {
    const levels = getProviderThinkingLevels({
      providerId: "grok-cli",
      models: [{ id: "grok-composer-2.5-fast" }],
      kiloFreeModels: [],
      customModels: [],
      providerStorageAlias: "grok-cli",
    });
    expect(levels).toBeNull();
  });
});
