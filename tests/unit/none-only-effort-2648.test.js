// #2648: a model whose declared efforts are only `none` cannot enable reasoning.
// An explicit reasoning request must neither be folded onto `none` (silently
// disabling it) nor forwarded as an undeclared tier; it is a local HTTP 400.
// Explicit `none`, requests without reasoning, and other models are unchanged.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import {
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
    expect(clampTierToSupported("bogus", ["none", "low", "high", "max"])).toBe("low");
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
    expect(responses({ reasoning_effort: "max" }, caps).reasoning?.effort).toBe("low");
    expect(responses({ reasoning_effort: "medium" }, caps).reasoning?.effort).toBe("medium");
  });

  it("keeps catalog rows like gpt-5.5 unchanged", () => {
    expect(resolveOpenAiEffort("high", "openai", "gpt-5.5")).toBe("high");
    expect(resolveOpenAiEffort("none", "openai", "gpt-5.5")).toBe("none");
  });
});
