// #2648: a model whose declared efforts are only `none` cannot enable reasoning.
// An explicit reasoning request must neither be folded onto `none` (silently
// disabling it) nor forwarded as an undeclared tier; it is a local HTTP 400.
// Explicit `none`, requests without reasoning, and other models are unchanged.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import {
  applyThinking,
  assertDeclaredEffortsCanReason,
  clampTierToSupported,
  normalizeToDeclaredTiers,
  resolveOpenAiEffort,
} from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const MODEL = "gpt-7-future";
const messages = [{ role: "user", content: "hello" }];
// Same merged shape loadCustomCapabilities builds over the unlisted Responses row.
const customCaps = (operator) => {
  const merged = { ...getCapabilitiesForModel("openai", MODEL), ...operator };
  Object.defineProperty(merged, "customKeys", { value: new Set(Object.keys(operator)), enumerable: false });
  return merged;
};
const translate = (target, body, modelCapabilities) => translateRequest(
  FORMATS.OPENAI, target, MODEL, { model: MODEL, messages, ...body },
  false, null, "openai", null, [], null, null, modelCapabilities ? { modelCapabilities } : undefined,
);
const responses = (body, caps) => translate(FORMATS.OPENAI_RESPONSES, body, caps);
const chat = (body, caps) => translate(FORMATS.OPENAI, body, caps);
const noneOnly = () => customCaps({ thinkingEfforts: ["none"] });

const catchError = (fn) => {
  try { fn(); } catch (error) { return error; }
  throw new Error("expected a throw");
};

describe("clampTierToSupported with a none-only tier set (#2648)", () => {
  it("keeps explicit none", () => {
    expect(clampTierToSupported("none", ["none"])).toBe("none");
  });

  it("rejects high and unknown tiers instead of returning none", () => {
    for (const level of ["high", "low", "max", "ultra", "bogus"]) {
      const error = catchError(() => clampTierToSupported(level, ["none"], MODEL));
      expect(error.statusCode).toBe(400);
      expect(error.unsupportedReasoningEffort).toBe(true);
      expect(error.message).toContain(`"${level}"`);
      expect(error.message).toContain(MODEL);
    }
  });

  it("never folds a reasoning request onto none when a reasoning tier exists", () => {
    // #2635 ranks unknown tiers as high.
    expect(clampTierToSupported("bogus", ["none", "low", "high", "max"])).toBe("high");
    expect(clampTierToSupported("medium", ["none", "low", "high", "max"])).toBe("high");
    expect(clampTierToSupported("none", ["low", "high"])).toBe("low");
    expect(clampTierToSupported("ultra", ["none", "low", "high", "max"])).toBe("max");
  });

  it("leaves empty or unranked declarations untouched", () => {
    expect(clampTierToSupported("high", [])).toBe("high");
    expect(clampTierToSupported("high", ["thinking"])).toBe("high");
  });

  it("normalizeToDeclaredTiers keeps none and rejects levels on a none-only set", () => {
    expect(normalizeToDeclaredTiers({ mode: "none" }, ["none"])).toEqual({ mode: "none" });
    expect(normalizeToDeclaredTiers({ mode: "auto" }, ["none"])).toEqual({ mode: "auto" });
    expect(catchError(() => normalizeToDeclaredTiers({ mode: "level", level: "high" }, ["none"])).statusCode).toBe(400);
  });
});

describe("OpenAI lanes for a custom model declaring only none (#2648)", () => {
  it("forwards explicit none on the Responses and chat lanes", () => {
    expect(responses({ reasoning_effort: "none" }, noneOnly()).reasoning?.effort).toBe("none");
    expect(chat({ reasoning_effort: "none" }, noneOnly()).reasoning_effort).toBe("none");
  });

  it("rejects explicit high, unknown and adaptive requests with a local 400", () => {
    for (const body of [
      { reasoning_effort: "high" },
      { reasoning: { effort: "xhigh" } },
      { reasoning_effort: "bogus" },
      { reasoning_effort: "auto" },
    ]) {
      for (const lane of [responses, chat]) {
        const error = catchError(() => lane(body, noneOnly()));
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('send "none"');
      }
    }
  });

  it("does not suggest none when the model cannot disable reasoning either", () => {
    const caps = customCaps({ thinkingEfforts: ["none"], thinkingCanDisable: false });
    const error = catchError(() => responses({ reasoning_effort: "high" }, caps));
    expect(error.statusCode).toBe(400);
    expect(error.message).not.toContain('send "none"');
  });

  it("leaves a request without reasoning untouched", () => {
    const body = responses({}, noneOnly());
    expect(body.reasoning).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("resolveOpenAiEffort refuses reasoning tiers but keeps none", () => {
    expect(resolveOpenAiEffort("none", "openai", MODEL, noneOnly())).toBe("none");
    expect(catchError(() => resolveOpenAiEffort("high", "openai", MODEL, noneOnly())).statusCode).toBe(400);
  });
});

describe("models with a reasoning tier are unaffected (#2648)", () => {
  it("keeps the declared-effort folding of #2635", () => {
    const caps = customCaps({ thinkingEfforts: ["low", "high"] });
    expect(responses({ reasoning_effort: "max" }, caps).reasoning?.effort).toBe("high");
    expect(responses({ reasoning_effort: "none" }, caps).reasoning?.effort).toBe("low");
  });

  it("keeps the unknown-levels fallback", () => {
    expect(responses({ reasoning_effort: "high" }).reasoning?.effort).toBe("high");
    expect(responses({ reasoning_effort: "none" }).reasoning).toBeUndefined();
  });

  it("does not fold a reasoning request onto a leading none tier", () => {
    const caps = customCaps({ thinkingEfforts: ["none", "low", "medium"] });
    // #2635 clamps by rank: above the declared range lands on the highest tier.
    expect(responses({ reasoning_effort: "max" }, caps).reasoning?.effort).toBe("medium");
    expect(responses({ reasoning_effort: "medium" }, caps).reasoning?.effort).toBe("medium");
  });

  it("keeps catalog rows like gpt-5.5 unchanged", () => {
    expect(resolveOpenAiEffort("high", "openai", "gpt-5.5")).toBe("high");
    expect(resolveOpenAiEffort("none", "openai", "gpt-5.5")).toBe("none");
  });
});

// Every provider-specific renderer runs after the central check in
// applyThinking, so none of them can fold a reasoning request onto `none`.
const RENDER_FORMATS = [
  "openai", "openai-responses", "openai-low-high-max", "llmtr", "tokenmarket", "ollama",
  "commandcode", "claude-adaptive", "claude-budget", "gemini-level", "gemini-budget", "zai",
  "qwen-effort", "qwen", "deepseek", "kimi", "opencode", "minimax", "hunyuan", "step", "kiro",
];
const formatCaps = (thinkingFormat, operator = {}) => {
  const caps = { reasoning: true, thinkingFormat, thinkingEfforts: ["none"], ...operator };
  Object.defineProperty(caps, "customKeys", {
    value: new Set(["thinkingFormat", "thinkingEfforts", ...Object.keys(operator)]), enumerable: false,
  });
  return caps;
};
const targetFor = (fmt) => fmt.startsWith("claude-") ? FORMATS.CLAUDE
  : fmt === "openai-responses" ? FORMATS.OPENAI_RESPONSES
    : fmt.startsWith("gemini-") ? FORMATS.GEMINI : FORMATS.OPENAI;
const render = (fmt, body, caps = formatCaps(fmt), provider = "custom-test", model = "none-only-model") =>
  applyThinking(targetFor(fmt), model, { model, messages, ...body }, provider, undefined, caps);
const REASONING_REQUESTS = [
  { reasoning_effort: "high" },
  { reasoning_effort: "bogus" },
  { reasoning_effort: "auto" },
  { thinking: { type: "enabled", budget_tokens: 4096 } },
  { thinking: { type: "adaptive" } },
  { output_config: { effort: "max" } },
];

describe("none-only validation runs before every effort renderer (#2648)", () => {
  for (const fmt of RENDER_FORMATS) {
    it(`${fmt}: rejects reasoning requests with a local 400 and keeps none`, () => {
      for (const body of REASONING_REQUESTS) {
        const error = catchError(() => render(fmt, body));
        expect(error.statusCode, `${fmt} ${JSON.stringify(body)}`).toBe(400);
        expect(error.unsupportedReasoningEffort).toBe(true);
      }
      expect(() => render(fmt, { reasoning_effort: "none" })).not.toThrow();
      expect(() => render(fmt, { thinking: { type: "disabled" } })).not.toThrow();
      expect(() => render(fmt, {})).not.toThrow();
    });
  }

  it("rejects a suffix override and an injected intent too", () => {
    const caps = formatCaps("deepseek");
    expect(catchError(() => applyThinking(FORMATS.OPENAI, "m(high)", { messages }, "custom-test", undefined, caps)).statusCode).toBe(400);
    expect(catchError(() => applyThinking(FORMATS.OPENAI, "m", { messages }, "custom-test", { mode: "level", level: "low" }, caps)).statusCode).toBe(400);
  });

  it("covers the provider early-return paths (native Claude, MiniMax, Gemini Hydrogen)", () => {
    const plain = { reasoning: true, thinkingEfforts: ["none"] };
    for (const [target, provider, model] of [
      [FORMATS.CLAUDE, "ollama", "llama-x"],
      [FORMATS.OPENAI, "minimax", "MiniMax-M3"],
      [FORMATS.OPENAI, "gemini-interactions", "gemini-4-hydrogen"],
    ]) {
      const error = catchError(() => applyThinking(target, model, { messages, reasoning_effort: "high" }, provider, undefined, plain));
      expect(error.statusCode, provider).toBe(400);
      expect(() => applyThinking(target, model, { messages, reasoning_effort: "none" }, provider, undefined, plain)).not.toThrow();
    }
  });

  it("rejects none as well when the model cannot disable thinking", () => {
    const caps = formatCaps("deepseek", { thinkingCanDisable: false });
    const error = catchError(() => render("deepseek", { reasoning_effort: "none" }, caps));
    expect(error.statusCode).toBe(400);
    expect(error.message).not.toContain('send "none"');
  });

  it("leaves models without reasoning, or with a reasoning tier, alone", () => {
    expect(() => assertDeclaredEffortsCanReason({ mode: "level", level: "high" }, { reasoning: false, thinkingEfforts: ["none"] })).not.toThrow();
    expect(() => assertDeclaredEffortsCanReason({ mode: "level", level: "high" }, { reasoning: true, thinkingEfforts: ["none", "high"] })).not.toThrow();
    expect(() => assertDeclaredEffortsCanReason(null, { reasoning: true, thinkingEfforts: ["none"] })).not.toThrow();
    const ok = render("deepseek", { reasoning_effort: "high" }, formatCaps("deepseek", { thinkingEfforts: ["none", "high"] }));
    expect(ok.thinking).toEqual({ type: "enabled" });
    const adaptive = render("claude-adaptive", { reasoning_effort: "high" }, formatCaps("claude-adaptive", { thinkingEfforts: ["none", "low", "high"] }));
    expect(adaptive.thinking?.type).toBe("adaptive");
    const lhm = render("openai-low-high-max", { reasoning_effort: "high" }, formatCaps("openai-low-high-max", { thinkingEfforts: ["low", "high", "max"] }));
    expect(lhm.reasoning_effort).toBe("high");
  });

  it("leaves static catalog rows alone", () => {
    expect(() => applyThinking(FORMATS.OPENAI, "deepseek-v4-pro", { messages, reasoning_effort: "high" }, "deepseek")).not.toThrow();
    expect(() => applyThinking(FORMATS.CLAUDE, "claude-opus-4-6", { messages, reasoning_effort: "high" }, "anthropic")).not.toThrow();
    expect(() => applyThinking(FORMATS.OPENAI, "deepseek-v4-pro", { messages, reasoning_effort: "high" }, "opencode-go")).not.toThrow();
  });
});
