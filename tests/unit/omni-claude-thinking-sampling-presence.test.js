import { describe, expect, it } from "vitest";

import "../translator/registerAll.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// OmniRoute #18639 (final head 90561d18) stopped `enforceThinkingTemperature` from
// pinning `temperature = 1` on a thinking request that carried no sampling field.
// DurinDoor has no such pin: nothing in the Claude path writes `temperature` or
// `top_p`. These offline tests lock the absent-stays-absent contract on every
// ordinary request shape, plus the explicit-field and disabled-thinking behavior.

const SAMPLING = ["temperature", "top_p", "top_k"];
const MODELS = ["claude-haiku-4-5-20251001", "claude-opus-4-6", "claude-opus-5", "claude-opus-5-5"];
const messages = [{ role: "user", content: "hi" }];
const has = (body, key) => Object.hasOwn(body, key);
const credentials = { apiKey: "offline-placeholder", accessToken: "offline-placeholder" };

const translate = (source, model, body, provider = "anthropic") =>
  translateRequest(source, FORMATS.CLAUDE, model, structuredClone(body), true, null, provider);

const shapes = {
  "chat completions": (model, sampling) =>
    translate(FORMATS.OPENAI, model, { messages, max_tokens: 4000, reasoning_effort: "medium", ...sampling }),
  responses: (model, sampling) =>
    translate(FORMATS.OPENAI_RESPONSES, model, { input: "hi", max_output_tokens: 4000, reasoning: { effort: "medium" }, ...sampling }),
  "native claude": (model, sampling) =>
    translate(FORMATS.CLAUDE, model, {
      messages,
      max_tokens: 4000,
      thinking: { type: "enabled", budget_tokens: 2048 },
      ...sampling,
    }),
};

describe("Claude thinking: absent sampling params stay absent", () => {
  for (const [shape, build] of Object.entries(shapes)) {
    for (const model of MODELS) {
      it(`${shape} → ${model} activates thinking without inventing sampling fields`, () => {
        const body = build(model, {});
        expect(["enabled", "adaptive"]).toContain(body.thinking?.type);
        for (const key of SAMPLING) expect(has(body, key), key).toBe(false);
      });
    }
  }

  it("executor wire shape (provider policy applied) adds no sampling fields", () => {
    for (const provider of ["anthropic", "claude"]) {
      const executor = new DefaultExecutor(provider);
      for (const model of MODELS) {
        for (const [shape, build] of Object.entries(shapes)) {
          const wire = executor.transformRequest(model, build(model, {}), true, credentials);
          expect(["enabled", "adaptive"]).toContain(wire.thinking?.type);
          for (const key of SAMPLING) expect(has(wire, key), `${provider} ${model} ${shape} ${key}`).toBe(false);
        }
      }
    }
  });

  it("a filter that removes a field is never undone by thinking normalization", () => {
    for (const model of MODELS) {
      const body = shapes["native claude"](model, { temperature: 0.7, top_p: 0.9, top_k: 5 });
      stripUnsupportedParams("anthropic", model, body);
      const after = structuredClone(body);
      // A second normalization pass over the filtered body must not re-add anything.
      const wire = new DefaultExecutor("anthropic").transformRequest(model, after, true, credentials);
      expect(has(wire, "temperature")).toBe(false);
      for (const key of ["top_p", "top_k"]) {
        expect(has(wire, key), `${model} ${key}`).toBe(has(body, key));
      }
    }
  });
});

describe("Claude thinking: explicit sampling fields", () => {
  it("direct OpenAI→Claude removes explicit temperature once thinking is active (no pin to 1)", () => {
    for (const model of ["claude-haiku-4-5-20251001", "claude-opus-4-6"]) {
      const body = shapes["chat completions"](model, { temperature: 0.7, top_p: 0.9 });
      expect(body.thinking?.type).not.toBe("disabled");
      expect(has(body, "temperature")).toBe(false);
      // OpenAI top_p is not translated to Claude on this route.
      expect(has(body, "top_p")).toBe(false);
    }
  });

  it("the executor never emits temperature for a Claude model, whatever the shape", () => {
    for (const model of MODELS) {
      for (const [shape, build] of Object.entries(shapes)) {
        const wire = new DefaultExecutor("claude").transformRequest(model, build(model, { temperature: 0.7 }), true, credentials);
        expect(has(wire, "temperature"), `${model} ${shape}`).toBe(false);
      }
    }
  });

  it("explicit top_p/top_k survive on models that support them and drop on Opus 5.5", () => {
    const supported = new DefaultExecutor("anthropic").transformRequest(
      "claude-opus-5",
      shapes["native claude"]("claude-opus-5", { top_p: 0.9, top_k: 5 }),
      true,
      credentials,
    );
    expect(supported).toMatchObject({ top_p: 0.9, top_k: 5 });
    const retired = new DefaultExecutor("anthropic").transformRequest(
      "claude-opus-5-5",
      shapes["native claude"]("claude-opus-5-5", { top_p: 0.9, top_k: 5 }),
      true,
      credentials,
    );
    expect(has(retired, "top_p")).toBe(false);
    expect(has(retired, "top_k")).toBe(false);
  });
});

describe("Claude thinking: disabled thinking keeps its current behavior", () => {
  it("OpenAI reasoning_effort none keeps explicit temperature", () => {
    for (const model of ["claude-haiku-4-5-20251001", "claude-opus-4-6"]) {
      const body = translate(FORMATS.OPENAI, model, { messages, max_tokens: 4000, temperature: 0.7, reasoning_effort: "none" });
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.temperature).toBe(0.7);
    }
  });

  it("native disabled thinking keeps explicit temperature and top_p", () => {
    const body = translate(FORMATS.CLAUDE, "claude-opus-4-6", {
      messages,
      max_tokens: 4000,
      temperature: 0.7,
      top_p: 0.9,
      thinking: { type: "disabled" },
    });
    expect(body).toMatchObject({ thinking: { type: "disabled" }, temperature: 0.7, top_p: 0.9 });
  });

  it("no thinking requested keeps explicit temperature on the direct route", () => {
    const body = translate(FORMATS.OPENAI, "claude-opus-4-6", { messages, max_tokens: 4000, temperature: 0.7 });
    expect(body.temperature).toBe(0.7);
  });
});
