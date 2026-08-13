import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel, resolveModelLimits } from "../../open-sse/providers/capabilities.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";
const GROK_UNPUBLISHED_OUTPUT_IDS = new Set([
  "grok-4.6",
  "grok-4.5",
  "grok-4.3",
  "grok-4.20-0309-reasoning",
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-multi-agent-0309",
  "grok-build-0.1",
  "grok-code-fast-1",
  "grok-composer-2.5-fast",
  "grok-build",
]);


describe("resolveModelLimits", () => {
  it("reports source and honesty for catalog, registry, pattern, and floor limits", () => {
    expect(resolveModelLimits("kiro", "gpt-5.6-sol")).toMatchObject({
      contextWindow: 1_050_000,
      maxOutput: 32_000,
      known: true,
      source: "provider",
    });
    expect(resolveModelLimits("api-airforce", "x-ai/grok-3")).toMatchObject({
      contextWindow: 131_072,
      maxOutput: 65_536,
      known: true,
      source: "registry",
    });
    expect(resolveModelLimits("unknown", "gpt-5-test")).toMatchObject({
      contextWindow: 400_000,
      maxOutput: 128_000,
      known: true,
      source: "pattern",
    });
    expect(resolveModelLimits("unknown", "not-a-real-model")).toEqual({
      contextWindow: 200_000,
      maxOutput: 64_000,
      known: false,
      source: "default",
    });
  });

  // A registry row that declares no limits is NOT evidence. Trusting the row's
  // absent fields would report `known: true` alongside undefined numbers —
  // strictly worse than admitting the limit is unknown. xAI documents
  // max_completion_tokens as a 128K DEFAULT, not a maximum (docs.x.ai chat
  // reference); storing it as maxOutput would impose a client-side ceiling xAI never published.
  it("never reports a known limit without documented numbers behind it", () => {
    let checked = 0;
    for (const providerId of Object.keys(PROVIDER_MODELS)) {
      for (const entry of PROVIDER_MODELS[providerId] ?? []) {
        const id = typeof entry === "string" ? entry : entry?.id;
        if (!id) continue;
        checked++;
        const limits = resolveModelLimits(providerId, id);
        if (!limits.known) continue;
        expect(limits.contextWindow, `${providerId}/${id} contextWindow`).toBeGreaterThan(0);
        if (!(providerId === "xai" && id.toLowerCase().includes("grok"))) {
          expect(limits.maxOutput, `${providerId}/${id} maxOutput`).toBeGreaterThan(0);
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  // A capability row that only sets feature flags carries no limit evidence.
  // Merging DEFAULT_CAPABILITIES over it would republish the generic floor as a
  // provider guarantee, which is exactly what the preflight must never reject on.
  it("treats feature-flag-only capability rows as unknown limits", () => {
    // PROVIDER_CAPABILITIES["kimi-web"]["k2d6"] is { tools: false }.
    expect(resolveModelLimits("kimi-web", "k2d6")).toMatchObject({ known: false, source: "default" });
    // PROVIDER_CAPABILITIES["devin"]["devin"] is { tools: false }.
    expect(resolveModelLimits("devin", "devin")).toMatchObject({ known: false, source: "default" });
  });

  it("keeps Grok's unpublished output ceiling unset without weakening other exact models", () => {
    // xAI documents max_completion_tokens as a 128K DEFAULT, not a maximum
    // (docs.x.ai chat reference); storing it as maxOutput would impose a
    // client-side ceiling xAI never published. The same applies to Grok CLI's
    // HAR-captured catalog, which publishes contexts but no output ceilings.
    for (const id of GROK_UNPUBLISHED_OUTPUT_IDS) {
      expect(getCapabilitiesForModel("xai", id).maxOutput, id).toBeUndefined();
    }
    expect(getCapabilitiesForModel("zai", "glm-4.6v")).toMatchObject({
      contextWindow: 128_000,
      maxOutput: 64_000,
    });
  });

  it("resolves a vendor-prefixed id against its bare model id", () => {
    expect(resolveModelLimits("openai", "openai/gpt-5.4").contextWindow).toBe(1_050_000);
  });
});

describe("effective output reservation", () => {
  const executor = new BaseExecutor("test", {});
  const context = { modelCapabilities: { maxOutput: 128_000 } };

  // The preflight and the clamp must agree on the budget: whatever the clamp
  // will let through is exactly what the request should be charged.
  it("matches what clampCustomMaxOutput actually lets through", () => {
    for (const field of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {
      const oversize = { [field]: 500_000 };
      const reserved = executor.resolveEffectiveOutputReservation(oversize, context);
      executor.clampCustomMaxOutput(oversize, context);
      expect(oversize[field], field).toBe(reserved);
      expect(reserved).toBe(128_000);
    }
  });

  it("mirrors the clamp for both Gemini envelope shapes", () => {
    const flat = { generationConfig: { maxOutputTokens: 500_000 } };
    const flatReserved = executor.resolveEffectiveOutputReservation(flat, context);
    executor.clampCustomMaxOutput(flat, context);
    expect(flat.generationConfig.maxOutputTokens).toBe(flatReserved);

    const wrapped = { request: { generationConfig: { maxOutputTokens: 500_000 } } };
    const wrappedReserved = executor.resolveEffectiveOutputReservation(wrapped, context);
    executor.clampCustomMaxOutput(wrapped, context);
    expect(wrapped.request.generationConfig.maxOutputTokens).toBe(wrappedReserved);
  });

  it("keeps a client value that already fits under the cap", () => {
    expect(executor.resolveEffectiveOutputReservation({ max_tokens: 4_096 }, context)).toBe(4_096);
  });

  it("charges the catalog cap when the client names no output limit", () => {
    expect(executor.resolveEffectiveOutputReservation({}, context)).toBe(128_000);
    expect(executor.resolveEffectiveOutputReservation({ max_tokens: 0 }, context)).toBe(128_000);
  });

  it("reserves nothing when neither the client nor the catalog gives a cap", () => {
    expect(executor.resolveEffectiveOutputReservation({}, {})).toBe(0);
  });
});
