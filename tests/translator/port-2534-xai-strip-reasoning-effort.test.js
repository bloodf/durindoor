// Regression for upstream decolua/9router#2534 — xAI grok-composer must not
// receive reasoning parameters, and Grok CLI non-reasoning models must not
// emit a `reasoning` block (cli-chat-proxy 400s otherwise).
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";

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


describe("port #2534: Grok CLI capability boundary", () => {
  it("keeps composer non-reasoning while grok-4.5 remains reasoning", () => {
    expect(getCapabilitiesForModel("grok-cli", "grok-composer-2.5-fast").reasoning).toBe(false);
    expect(getCapabilitiesForModel("grok-cli", "grok-4.5").reasoning).toBe(true);
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

