import { describe, expect, it } from "vitest";
import {
  applyContextRequirements,
  getKnownContextWindow,
} from "../../open-sse/services/combo/contextRequirements.js";
import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, debug() {}, error() {} };

// Fixtures grounded in the real provider registry (open-sse/providers/registry/github-models.js):
//   openai/gpt-4.1    -> contextLength 1047576 (large)
//   microsoft/Phi-4   -> contextLength 16384   (small)
// `ghm` is the registry ALIAS for canonical provider id `github-models`, so alias-form
// members exercise the alias->entry map and the canonical-provider capability lookup.
const LARGE = "github-models/openai/gpt-4.1"; // 1047576
const LARGE_ALIAS = "ghm/openai/gpt-4.1"; // same model via alias
const SMALL = "github-models/microsoft/Phi-4"; // 16384
const UNKNOWN = "custom/no-catalog-entry"; // no registry entry / capability context

describe("getKnownContextWindow", () => {
  it("resolves context from the provider registry per-model contextLength", () => {
    expect(getKnownContextWindow(LARGE)).toBe(1047576);
    expect(getKnownContextWindow(SMALL)).toBe(16384);
  });

  it("resolves context through a registry ALIAS to the same canonical value", () => {
    expect(getKnownContextWindow(LARGE_ALIAS)).toBe(1047576);
  });

  it("returns null for a model with no explicit context anywhere (never the DEFAULT floor)", () => {
    // Critical: getCapabilitiesForModel would merge DEFAULT_CAPABILITIES.contextWindow
    // (200000) and make this unknown model look known. This resolver must stay null.
    expect(getKnownContextWindow(UNKNOWN)).toBeNull();
  });
});

describe("applyContextRequirements", () => {
  it("returns the SAME array reference and order when no requirement is configured", () => {
    const models = [SMALL, LARGE, UNKNOWN];
    expect(applyContextRequirements(models, undefined, log)).toBe(models);
    expect(applyContextRequirements(models, null, log)).toBe(models);
    expect(applyContextRequirements(models, {}, log)).toBe(models);
    expect(applyContextRequirements(models, { contextFilterMode: "strict" }, log)).toBe(models);
  });

  it("match control: keeps models with context >= minContextWindow", () => {
    const models = [SMALL, LARGE];
    const out = applyContextRequirements(models, { minContextWindow: 128000 }, log);
    expect(out).toEqual([LARGE]);
  });

  it("mismatch control (lenient default): drops known-below-min but keeps unknown-context models", () => {
    const models = [SMALL, UNKNOWN, LARGE];
    const out = applyContextRequirements(models, { minContextWindow: 128000 }, log);
    expect(out).toEqual([UNKNOWN, LARGE]); // order preserved, SMALL dropped, UNKNOWN kept
  });

  it("mismatch control (strict): drops known-below-min AND unknown-context models", () => {
    const models = [SMALL, UNKNOWN, LARGE];
    const out = applyContextRequirements(
      models,
      { minContextWindow: 128000, contextFilterMode: "strict" },
      log
    );
    expect(out).toEqual([LARGE]);
  });

  it("strict mode with minContextWindow 0 keeps known sizes but drops unknown-context models", () => {
    // Regression: parseRequirements must not collapse a configured 0 minimum to
    // "unset" — that would silently disable strict unknown-drop.
    const out = applyContextRequirements(
      [SMALL, UNKNOWN, LARGE],
      { minContextWindow: 0, contextFilterMode: "strict" },
      log
    );
    expect(out).toEqual([SMALL, LARGE]);
  });

  it("treats alias-form members identically to canonical-form under filtering", () => {
    const models = [SMALL, LARGE_ALIAS];
    const out = applyContextRequirements(models, { minContextWindow: 128000 }, log);
    expect(out).toEqual([LARGE_ALIAS]);
  });

  it("preferLargeContext sorts descending, unknown to the end, stable on ties", () => {
    const models = [SMALL, UNKNOWN, LARGE];
    const out = applyContextRequirements(models, { preferLargeContext: true }, log);
    expect(out).toEqual([LARGE, SMALL, UNKNOWN]);
  });

  it("locks in first-matching-pattern-without-context => unknown (no silent fallthrough)", () => {
    // A model whose first matching PATTERN_CAPABILITIES entry declares no contextWindow
    // must be treated as unknown (matches getCapabilitiesForModel first-match behavior),
    // NOT scanned further into a later pattern that does declare one.
    const unknown = "custom/no-catalog-entry";
    expect(getKnownContextWindow(unknown)).toBeNull();
    // And under strict filtering such a model is excluded.
    const out = applyContextRequirements([unknown, LARGE], { minContextWindow: 1, contextFilterMode: "strict" }, log);
    expect(out).toEqual([LARGE]);
  });
});

describe("handleComboChat context-requirements plumbing", () => {
  it("filters a strict-excluded model out of the dispatch order entirely", async () => {
    const comboName = `ctx-rr-${Date.now()}`;
    resetComboRotation(comboName);
    const tried = [];

    // Fallback over [SMALL, LARGE]; strict minContextWindow excludes SMALL at the
    // eligibility step (pre-rotation), so SMALL is never in the dispatch pool and
    // must never be attempted regardless of strategy.
    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: [SMALL, LARGE],
      comboName,
      comboStrategy: "fallback",
      comboStickyLimit: 1,
      autoSwitch: false, // feature must work even with auto-switch off
      contextRequirements: { minContextWindow: 128000, contextFilterMode: "strict" },
      log,
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        return Response.json({ choices: [{ message: { role: "assistant", content: model } }] });
      },
    });

    expect(res.ok).toBe(true);
    expect(tried).toEqual([LARGE]); // SMALL filtered out -> never attempted
  });

  it("preserves exact round-robin sequence among survivors when the scheduled member is strict-excluded", async () => {
    const comboName = `ctx-rr-seq-${Date.now()}`;
    resetComboRotation(comboName);
    const tried = [];

    // Pool of 3: SMALL(excluded), MID(200000), LARGE(1047576). Strict min 128000
    // excludes SMALL. The eligibility filter runs BEFORE getRotatedModels, so the
    // round-robin pointer advances over the ELIGIBLE set [MID, LARGE] and the
    // survivor sequence is an exact alternation (no pointer skew).
    const MID = "github-models/openai/gpt-4o"; // contextLength 200000
    const serve = async () => {
      const res = await handleComboChat({
        body: { messages: [{ role: "user", content: "hi" }] },
        models: [SMALL, MID, LARGE],
        comboName,
        comboStrategy: "round-robin",
        comboStickyLimit: 1,
        autoSwitch: false,
        contextRequirements: { minContextWindow: 128000, contextFilterMode: "strict" },
        log,
        handleSingleModel: async (_body, model) => {
          tried.push(model);
          return Response.json({ choices: [{ message: { role: "assistant", content: model } }] });
        },
      });
      return res.ok;
    };

    const results = [await serve(), await serve(), await serve(), await serve()];
    expect(results).toEqual([true, true, true, true]);
    // Exact survivor round-robin over the eligible pool: SMALL never attempted,
    // and the pointer alternates MID/LARGE because it never lands on SMALL.
    expect(tried).toEqual([MID, LARGE, MID, LARGE]);
  });

  it("preferLargeContext dispatches the larger-context model first when no higher-priority routing runs", async () => {
    const comboName = `ctx-prefer-${Date.now()}`;
    resetComboRotation(comboName);
    let first = null;

    // [SMALL, LARGE] with preferLargeContext: the sort re-orders the rotated
    // targets so LARGE is tried first. autoSwitch:false and no quotaRanker, so
    // no capability/task/quota stage supersedes the context-preference order.
    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: [SMALL, LARGE],
      comboName,
      comboStrategy: "fallback",
      autoSwitch: false,
      contextRequirements: { preferLargeContext: true },
      log,
      handleSingleModel: async (_body, model) => {
        if (first === null) first = model;
        return Response.json({ choices: [{ message: { role: "assistant", content: model } }] });
      },
    });

    expect(res.ok).toBe(true);
    expect(first).toBe(LARGE); // larger context preferred first
  });

  it("returns 503 when the requirement filters the pool to empty", async () => {
    const comboName = `ctx-empty-${Date.now()}`;
    resetComboRotation(comboName);
    let called = false;

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: [SMALL],
      comboName,
      comboStrategy: "fallback",
      autoSwitch: false,
      contextRequirements: { minContextWindow: 128000 }, // SMALL(16384) < min -> empty
      log,
      handleSingleModel: async () => {
        called = true;
        return Response.json({});
      },
    });

    expect(res.status).toBe(503);
    expect(called).toBe(false); // fail-fast before any dispatch
    const body = await res.json();
    expect(body.error.message).toMatch(/no models matching context requirements/);
  });

  it("preserves fallback order and target set when no requirement is configured", async () => {
    const comboName = `ctx-none-${Date.now()}`;
    resetComboRotation(comboName);
    const tried = [];

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: [SMALL, LARGE],
      comboName,
      comboStrategy: "fallback",
      autoSwitch: false,
      log,
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        if (model === SMALL) {
          return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
        }
        return Response.json({ choices: [{ message: { role: "assistant", content: model } }] });
      },
    });

    expect(res.ok).toBe(true);
    expect(tried).toEqual([SMALL, LARGE]); // unchanged fallback order, both attempted
  });
});
