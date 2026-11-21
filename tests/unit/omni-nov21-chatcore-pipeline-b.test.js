// OmniRoute chat pipeline and executor bundles, part B (#20194, #20201, #20199), offline fixtures only.
// Components DurinDoor lacks (request dedup, skills, pooled sessions, CLI fingerprint, Qoder CLI,
// in-pipeline account rotation) are recorded as not applicable in the port reports, not pinned here.
import "../translator/registerAll.js";
import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { normalizeClaudePassthrough, dropClaudeCodeIdentitySystem } from "../../open-sse/translator/formats/claude.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { dedupeTools } from "../../open-sse/utils/toolDeduper.js";
import { buildTransformStream } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { isTokenExpiringSoon } from "../../open-sse/handlers/chatCore.js";
import { mergeAbortSignals } from "../../open-sse/executors/websession-utils.js";

// ── #20194 shared combo request data ──────────────────────────────────────────────────────
// A combo hands every target a shallow copy of the client body, so nested objects are shared.
// Per-target request rewrites must replace a nested object, never edit it in place.
describe("#20194 nested request data stays unchanged across combo targets", () => {
  it("leaves the client's Claude output_config.effort for the next target on a legacy Haiku model", () => {
    const shared = { effort: "high", format: { type: "json_schema" } };
    const body = {
      model: "claude-3-haiku-20240307",
      max_tokens: 100,
      output_config: shared,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    };
    const target = { ...body };
    normalizeClaudePassthrough(target, "claude-3-haiku-20240307", "claude");
    expect(target.output_config?.effort).toBeUndefined();
    expect(target.output_config?.format).toEqual({ type: "json_schema" });
    expect(body.output_config).toBe(shared);
    expect(shared).toEqual({ effort: "high", format: { type: "json_schema" } });
  });

  it("drops an effort-only output_config on the copy without emptying the shared object", () => {
    const shared = { effort: "high" };
    const target = { model: "claude-3-haiku-20240307", output_config: shared, messages: [] };
    normalizeClaudePassthrough(target, "claude-3-haiku-20240307", "claude");
    expect(target.output_config).toBeUndefined();
    expect(shared).toEqual({ effort: "high" });
  });

  it("keeps the shared Responses reasoning object whole when a target strips reasoning.effort", () => {
    const reasoning = { effort: "high", summary: "auto" };
    const body = { model: "gpt-4o", input: "hi", reasoning };
    const target = applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-5", { ...body }, "openai", { mode: "level", level: "low" });
    expect(target.reasoning?.summary).toBe("auto");
    expect(reasoning).toEqual({ effort: "high", summary: "auto" });
  });

  it("keeps the shared Gemini generationConfig whole when a target strips thinkingConfig", () => {
    const generationConfig = { temperature: 0.2, thinkingConfig: { thinkingBudget: 512 } };
    const body = { model: "gemini-2.0-flash", contents: [], generationConfig };
    applyThinking(FORMATS.GEMINI, "gemini-2.0-flash", { ...body }, "gemini", undefined, { reasoning: false });
    expect(generationConfig).toEqual({ temperature: 0.2, thinkingConfig: { thinkingBudget: 512 } });
  });

  it("does not add effort to the caller's output_config when folding reasoning_effort for ollama", () => {
    const outputConfig = { format: { type: "json_schema" } };
    const target = { model: "x", reasoning_effort: "high", output_config: outputConfig };
    applyThinking(FORMATS.CLAUDE, "x", target, "ollama");
    expect(target.output_config.effort).toBe("high");
    expect(outputConfig).toEqual({ format: { type: "json_schema" } });
  });

  it("two sequential translations of one shallow-copied body see the same nested input", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      reasoning: { effort: "high", summary: "auto" }
    };
    const snapshot = structuredClone(body);
    translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", { ...body }, false, null, "openai");
    translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", { ...body }, false, null, "openai");
    expect(body).toEqual(snapshot);
  });
});

// ── #20194 DeepSeek duplicate tool names (already in) ─────────────────────────────────────
describe("#20194 DeepSeek-only tool name dedupe", () => {
  const tools = [
    { type: "function", function: { name: "run", parameters: {} } },
    { type: "function", function: { name: "run", parameters: { type: "object" } } },
    { type: "function", function: { name: "other", parameters: {} } }
  ];

  it("keeps the first definition of a repeated name for deepseek-* ids on any gateway", () => {
    for (const model of ["deepseek-chat", "deepseek/deepseek-reasoner", "DeepSeek-V3"]) {
      const { tools: out } = dedupeTools(tools, { model });
      expect(out.map((t) => t.function.name)).toEqual(["run", "other"]);
      expect(out[0]).toBe(tools[0]);
    }
  });

  it("leaves other models alone", () => {
    expect(dedupeTools(tools, { model: "gpt-4o" }).tools).toBe(tools);
  });
});

// ── #20199 request format detection ───────────────────────────────────────────────────────
describe("#20199 Android user agents are not Droid CLI", () => {
  // A Gemini-format client of a Responses provider is translated to the Antigravity wire by the
  // Codex branch only; a Droid/codex-cli client skips that branch and keeps its own format.
  const build = (userAgent) =>
    buildTransformStream({
      provider: "codex",
      sourceFormat: FORMATS.GEMINI,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      userAgent
    });

  it("takes the Codex translation branch for an Android client", () => {
    expect(build("Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8)").emittedFormat).toBe(FORMATS.ANTIGRAVITY);
    expect(build("Mozilla/5.0 (Linux; Android 14) Mobile Safari").emittedFormat).toBe(FORMATS.ANTIGRAVITY);
  });

  it("still skips it for Droid and codex-cli clients", () => {
    expect(build("factory-cli/0.9 droid/1.2").emittedFormat).toBe(FORMATS.GEMINI);
    expect(build("Droid").emittedFormat).toBe(FORMATS.GEMINI);
    expect(build("codex-cli/0.20").emittedFormat).toBe(FORMATS.GEMINI);
  });
});

// ── #20199 token expiry parsing ───────────────────────────────────────────────────────────
describe("#20199 token expiry units", () => {
  const HOUR_MS = 60 * 60 * 1000;

  it("reads epoch seconds", () => {
    expect(isTokenExpiringSoon(Math.floor((Date.now() + HOUR_MS) / 1000))).toBe(false);
    expect(isTokenExpiringSoon(Math.floor((Date.now() + 60_000) / 1000))).toBe(true);
  });

  it("reads numeric strings as epoch times, not as an invalid date", () => {
    expect(isTokenExpiringSoon(String(Date.now() - 1000))).toBe(true);
    expect(isTokenExpiringSoon(String(Date.now() + HOUR_MS))).toBe(false);
    expect(isTokenExpiringSoon(String(Math.floor((Date.now() + HOUR_MS) / 1000)))).toBe(false);
  });

  it("keeps ISO strings, Dates and milliseconds working", () => {
    expect(isTokenExpiringSoon(new Date(Date.now() + HOUR_MS).toISOString())).toBe(false);
    expect(isTokenExpiringSoon(new Date(Date.now() + 60_000))).toBe(true);
    expect(isTokenExpiringSoon(Date.now() + HOUR_MS)).toBe(false);
    expect(isTokenExpiringSoon(Date.now() + 60_000)).toBe(true);
  });

  it("never reports a missing or unreadable value as expiring", () => {
    expect(isTokenExpiringSoon(null)).toBe(false);
    expect(isTokenExpiringSoon(undefined)).toBe(false);
    expect(isTokenExpiringSoon("not a date")).toBe(false);
  });
});

// ── #20201 Claude Code identity block keeps client text ───────────────────────────────────
describe("#20201 identity sentinel and client text in one system block", () => {
  it("removes only the sentinel line from a mixed block", () => {
    const body = {
      system: [
        { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude.\nAlways answer in French." },
        { type: "text", text: "Second block." }
      ]
    };
    dropClaudeCodeIdentitySystem(body);
    expect(body.system).toEqual([
      { type: "text", text: "Always answer in French." },
      { type: "text", text: "Second block." }
    ]);
  });

  it("still drops a block that holds only the sentinel or billing line", () => {
    const body = {
      system: [
        { type: "text", text: "x-anthropic-billing-header: cc_version=1; cch=abc;" },
        { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
        { type: "text", text: "Keep me." }
      ]
    };
    dropClaudeCodeIdentitySystem(body);
    expect(body.system).toEqual([{ type: "text", text: "Keep me." }]);
  });

  it("does not touch an identity-looking line in the middle of a block", () => {
    const body = { system: [{ type: "text", text: "Rules.\nYou are Claude Code, Anthropic's official CLI for Claude." }] };
    dropClaudeCodeIdentitySystem(body);
    expect(body.system[0].text).toBe("Rules.\nYou are Claude Code, Anthropic's official CLI for Claude.");
  });
});

// ── #20201 merged abort signals (already in) ──────────────────────────────────────────────
describe("#20201 merged abort signals leave no listener on the long-lived signal", () => {
  function tracked() {
    const controller = new AbortController();
    let live = 0;
    const add = controller.signal.addEventListener.bind(controller.signal);
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args) => {
      live += 1;
      return add(...args);
    };
    controller.signal.removeEventListener = (...args) => {
      live -= 1;
      return remove(...args);
    };
    return { controller, live: () => live };
  }

  it("holds no listener after a merge that never aborts", () => {
    const { controller, live } = tracked();
    const other = new AbortController();
    const merged = mergeAbortSignals(controller.signal, other.signal);
    expect(merged.aborted).toBe(false);
    expect(live()).toBeLessThanOrEqual(0);
  });

  it("aborts with the source reason and releases its listeners", () => {
    const { controller, live } = tracked();
    const other = new AbortController();
    const merged = mergeAbortSignals(controller.signal, other.signal);
    other.abort("deadline");
    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe("deadline");
    expect(live()).toBeLessThanOrEqual(0);
  });
});
