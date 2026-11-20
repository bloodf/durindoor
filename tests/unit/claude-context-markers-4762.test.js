import { describe, expect, it, vi } from "vitest";
import {
  decodeClaudeCodeModelId,
  projectClaudeCodeModel,
} from "../../src/app/api/v1/models/_claudeCompat.js";

// Port of upstream 9router #4762 (Residual 4762-A): a Claude Code context
// suffix other than `[1m]` (for example `[200k]`) used to survive model
// resolution and fail the request with HTTP 400 "Invalid model format".
//
// Contract pinned here:
//   - decode recognizes a trailing `[<digits><m|k>]` suffix only;
//   - advertisement stays `[1m]` and only for a proven 1M window;
//   - a discovered model whose literal name includes brackets is preserved;
//   - embedded suffixes, malformed suffixes and unknown models are untouched.

/**
 * Build a routability checker with the same two-tier shape the real
 * `createRoutableModelIdChecker` exposes: an `exact` tier for ids that exist
 * literally, and a looser tier for aliases and combos.
 */
function createChecker({ exact = [], routable = [] } = {}) {
  const exactIds = new Set(exact);
  const routableIds = new Set([...exact, ...routable]);
  return vi.fn(async (id, { exact: onlyExact = false } = {}) => {
    if (onlyExact) return exactIds.has(id);
    return routableIds.has(id);
  });
}

describe("Claude Code context marker decoding (#4762)", () => {
  it("decodes a trailing [200k] suffix to the underlying routable model", async () => {
    const routable = createChecker({ exact: ["claude-sonnet-5"] });

    await expect(decodeClaudeCodeModelId("claude-sonnet-5[200k]", routable)).resolves.toBe("claude-sonnet-5");
  });

  it("decodes other trailing context suffixes of the same shape", async () => {
    const routable = createChecker({ exact: ["claude-sonnet-5", "claude-haiku-4.5"] });

    await expect(decodeClaudeCodeModelId("claude-sonnet-5[128k]", routable)).resolves.toBe("claude-sonnet-5");
    await expect(decodeClaudeCodeModelId("claude-haiku-4.5[2m]", routable)).resolves.toBe("claude-haiku-4.5");
  });

  it("decodes a suffixed provider route without the claude- prefix", async () => {
    const routable = createChecker({ exact: ["openai/gpt-5.5"] });

    await expect(decodeClaudeCodeModelId("openai/gpt-5.5[200k]", routable)).resolves.toBe("openai/gpt-5.5");
  });

  it("matches the suffix case-insensitively", async () => {
    const routable = createChecker({ exact: ["claude-sonnet-5", "claude-opus-5"] });

    await expect(decodeClaudeCodeModelId("claude-sonnet-5[200K]", routable)).resolves.toBe("claude-sonnet-5");
    await expect(decodeClaudeCodeModelId("claude-opus-5[1M]", routable)).resolves.toBe("claude-opus-5");
  });

  it("leaves an embedded suffix untouched", async () => {
    const routable = createChecker({ exact: ["openai/gpt-5.5", "claude-sonnet-5"] });

    await expect(decodeClaudeCodeModelId("claude-sonnet-5[200k]extra", routable)).resolves.toBe("claude-sonnet-5[200k]extra");
    await expect(decodeClaudeCodeModelId("openai/gpt-5.5[200k]extra", routable)).resolves.toBe("openai/gpt-5.5[200k]extra");
    await expect(decodeClaudeCodeModelId("claude-openai/gpt-5.5[1m]extra", routable)).resolves.toBe("claude-openai/gpt-5.5[1m]extra");
  });

  it("leaves malformed and unknown suffixes untouched", async () => {
    const routable = createChecker({ exact: ["claude-sonnet-5"] });

    await expect(decodeClaudeCodeModelId("claude-sonnet-5[abc]", routable)).resolves.toBe("claude-sonnet-5[abc]");
    await expect(decodeClaudeCodeModelId("claude-sonnet-5[1x]", routable)).resolves.toBe("claude-sonnet-5[1x]");
    await expect(decodeClaudeCodeModelId("claude-sonnet-5[m]", routable)).resolves.toBe("claude-sonnet-5[m]");
    await expect(decodeClaudeCodeModelId("claude-sonnet-5[1mm]", routable)).resolves.toBe("claude-sonnet-5[1mm]");
    await expect(decodeClaudeCodeModelId("claude-sonnet-5[]", routable)).resolves.toBe("claude-sonnet-5[]");
    await expect(decodeClaudeCodeModelId("claude-sonnet-5[200k", routable)).resolves.toBe("claude-sonnet-5[200k");
  });

  it("leaves an unknown model with a suffix untouched", async () => {
    const routable = createChecker({ exact: ["claude-sonnet-5"] });

    await expect(decodeClaudeCodeModelId("claude-sonnet-unknown-xyz[200k]", routable)).resolves.toBe("claude-sonnet-unknown-xyz[200k]");
    await expect(decodeClaudeCodeModelId("claude-sonnet-unknown-xyz", routable)).resolves.toBe("claude-sonnet-unknown-xyz");
  });

  it("preserves a discovered model whose literal name includes brackets", async () => {
    const routable = createChecker({
      exact: ["literal/model[200k]", "literal/model[beta]", "literal/model[1m]"],
    });

    // The literal id is routable on its own, so it must never be rewritten.
    await expect(decodeClaudeCodeModelId("literal/model[200k]", routable)).resolves.toBe("literal/model[200k]");
    await expect(decodeClaudeCodeModelId("literal/model[beta]", routable)).resolves.toBe("literal/model[beta]");
    await expect(decodeClaudeCodeModelId("literal/model[1m]", routable)).resolves.toBe("literal/model[1m]");

    // The projected spelling resolves back to the same literal id.
    await expect(decodeClaudeCodeModelId("claude-literal/model[200k]", routable)).resolves.toBe("literal/model[200k]");
    await expect(decodeClaudeCodeModelId("claude-literal/model[beta]", routable)).resolves.toBe("literal/model[beta]");
  });

  it("keeps the existing [1m] decode results unchanged", async () => {
    const routable = createChecker({
      exact: ["openai/gpt-5.5", "claude-opus-5", "literal/model[1m]"],
      routable: ["coding-default"],
    });

    await expect(decodeClaudeCodeModelId("claude-openai/gpt-5.5[1m]", routable)).resolves.toBe("openai/gpt-5.5");
    await expect(decodeClaudeCodeModelId("claude-coding-default", routable)).resolves.toBe("coding-default");
    await expect(decodeClaudeCodeModelId("claude-opus-5[1m]", routable)).resolves.toBe("claude-opus-5");
    await expect(decodeClaudeCodeModelId("literal/model[1m]", routable)).resolves.toBe("literal/model[1m]");
    await expect(decodeClaudeCodeModelId("openai/gpt[1m]extra", routable)).resolves.toBe("openai/gpt[1m]extra");
    await expect(decodeClaudeCodeModelId("claude-sonnet-unknown-xyz", routable)).resolves.toBe("claude-sonnet-unknown-xyz");
  });

  it("keeps a projected route whose literal id ends in a suffix", async () => {
    const routable = createChecker({ exact: ["kimi/k3[1m]"] });

    await expect(decodeClaudeCodeModelId("claude-kimi/k3[1m]", routable)).resolves.toBe("kimi/k3[1m]");
  });

  it("does not touch input that carries no suffix", async () => {
    const routable = createChecker({ exact: ["openai/gpt-5.5"], routable: ["coding-default"] });

    await expect(decodeClaudeCodeModelId("openai/gpt-5.5", routable)).resolves.toBe("openai/gpt-5.5");
    await expect(decodeClaudeCodeModelId("", routable)).resolves.toBe("");
    await expect(decodeClaudeCodeModelId(null, routable)).resolves.toBe(null);
    await expect(decodeClaudeCodeModelId(undefined, routable)).resolves.toBe(undefined);
  });
});

describe("Claude Code context advertisement (#4762)", () => {
  it("keeps advertising [1m] only for a proven 1M window", () => {
    expect(projectClaudeCodeModel({ id: "openai/gpt-5.5", owned_by: "openai" }, () => ({ known: true, contextWindow: 1_050_000 }))).toBe("claude-openai/gpt-5.5[1m]");
    expect(projectClaudeCodeModel({ id: "openai/gpt-5", owned_by: "openai" }, () => ({ known: true, contextWindow: 400_000 }))).toBe("claude-openai/gpt-5");
    expect(projectClaudeCodeModel({ id: "openai/gpt-5", owned_by: "openai" }, () => ({ known: true, contextWindow: 200_000 }))).toBe("claude-openai/gpt-5");
    expect(projectClaudeCodeModel({ id: "custom/future", owned_by: "custom" }, () => ({ known: false, contextWindow: 2_000_000 }))).toBe("claude-custom/future");
  });

  it("does not advertise a context size that was not proven", () => {
    // A 200k-proven row must not gain a marker: only a 1M window may be
    // advertised as `[1m]`, and no other suffix may be advertised at all.
    expect(projectClaudeCodeModel({ id: "openai/gpt-5", owned_by: "openai" }, () => ({ known: true, contextWindow: 200_000 }))).not.toContain("[");
  });

  it("preserves a discovered model whose literal name includes brackets", () => {
    expect(projectClaudeCodeModel({ id: "kimi/k3[1m]" }, () => ({ known: true, contextWindow: 1_048_576 }))).toBe("claude-kimi/k3[1m]");
    expect(projectClaudeCodeModel({ id: "kimi/k3[preview]" }, () => ({ known: true, contextWindow: 200_000 }))).toBe("claude-kimi/k3[preview]");
    expect(projectClaudeCodeModel({ id: "claude-sonnet-future" }, () => ({ known: true, contextWindow: 2_000_000 }))).toBe("claude-sonnet-future");
  });
});
