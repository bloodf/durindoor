import { describe, expect, it } from "vitest";
import {
  extractModelIds,
  extractExtraIds,
  localAudit,
  renderReport,
  comparisonReport,
} from "../../scripts/model-catalog-diff.mjs";

const FORMATS = new Set(["openai", "claude", "gemini", "openai-responses"]);

describe("extractModelIds", () => {
  it("captures model-row id: values and direct array string elements", () => {
    const src = `
      export default {
        id: "demo-provider",
        models: [
          "gpt-5.6-sol",
          { id: "claude-sonnet-5", name: "Claude Sonnet 5", targetFormat: "claude" },
          { id: "gemini-2.5-pro", capabilities: ["vision", "tools"], params: ["temperature"] },
        ],
        serviceKinds: ["llm", "image"],
      };
    `;
    const ids = extractModelIds(src);
    expect(ids.has("gpt-5.6-sol")).toBe(true);
    expect(ids.has("claude-sonnet-5")).toBe(true);
    expect(ids.has("gemini-2.5-pro")).toBe(true);
  });

  it("excludes provider-root id: (not a model) and out-of-array tokens", () => {
    const src = `
      import { foo } from "open-sse/translator/formats.js";
      const baseUrl = "https://api.example.com/v1";
      export default {
        id: "demo-provider",
        alias: "dp",
        format: "openai",
        models: [{ id: "kept-model" }],
      };
    `;
    const ids = extractModelIds(src);
    expect(ids.has("kept-model")).toBe(true);
    expect(ids.has("demo-provider")).toBe(false); // root id: must NOT leak
    expect(ids.has("openai")).toBe(false);         // root format: must NOT leak
    expect([...ids].some((x) => x.includes("translator"))).toBe(false);
    expect([...ids].some((x) => x.includes("api.example.com"))).toBe(false);
  });

  it("does NOT treat nested property strings as model ids", () => {
    const src = `
      models: [
        { id: "real-model", name: "some-display-name", targetFormat: "openai-responses",
          capabilities: ["text2img"], params: ["quality"] }
      ]
    `;
    const ids = extractModelIds(src);
    expect(ids.has("real-model")).toBe(true);
    expect(ids.has("openai-responses")).toBe(false);
    expect(ids.has("text2img")).toBe(false);
    expect(ids.has("quality")).toBe(false);
  });

  it("returns empty set for null/empty source", () => {
    expect(extractModelIds(null).size).toBe(0);
    expect(extractModelIds("").size).toBe(0);
  });
});

describe("extractExtraIds", () => {
  it("captures pricing object keys (ours/upstream pricing.js shape), NOT globs", () => {
    const src = `
      export const MODEL_PRICING = {
        "gpt-5.6-sol": { input: 5.0, output: 30.0 },
        "claude-sonnet-5": { input: 3.0, output: 15.0 },
      };
      export const PATTERN_PRICING = [
        { pattern: "gpt-5.6-*", pricing: { input: 2.5 } },
      ];
    `;
    const ids = extractExtraIds(src, "__pricing__");
    expect(ids.has("gpt-5.6-sol")).toBe(true);
    expect(ids.has("claude-sonnet-5")).toBe(true);
    // glob patterns must NOT be emitted as fake concrete ids
    expect(ids.has("gpt-5.6")).toBe(false);
    expect(ids.has("gpt-5.6-*")).toBe(false);
  });

  it("captures omniroute providerCostData.ts KNOWN_MODEL_PRICING keys", () => {
    const src = `
      export const KNOWN_MODEL_PRICING: Record<string, ModelPricing> = {
        "gpt-4o": { inputCostPer1M: 2.5, outputCostPer1M: 10.0, isFree: false },
        "claude-fable-5": { inputCostPer1M: 15.0, outputCostPer1M: 75.0, isFree: false },
      };
    `;
    const ids = extractExtraIds(src, "__pricing__");
    expect(ids.has("gpt-4o")).toBe(true);
    expect(ids.has("claude-fable-5")).toBe(true);
  });

  it("captures concrete keys incl. uppercase ids, excludes pattern globs", () => {
    const src = `
      const MAP = {
        "MiniMax-M2.1": { input: 0.2 },
        "MiniMax-M3": { input: 0.3 },
        "gpt-4o": { input: 2.5 },
      };
      export const THINKING_LEVELS = [
        { pattern: "*gpt-5.6-sol*", levels: ["none","low","high"] },
      ];
    `;
    const ids = extractExtraIds(src, "__capabilities__");
    expect(ids.has("MiniMax-M2.1")).toBe(true);
    expect(ids.has("MiniMax-M3")).toBe(true);
    expect(ids.has("gpt-4o")).toBe(true);
    expect(ids.has("gpt-5.6-sol")).toBe(false); // pattern, not an id
  });
});

describe("localAudit", () => {
  it("flags duplicate ids within a provider and orphan pricing rows", async () => {
    const registry = [
      { id: "demo", models: [{ id: "m-a" }, { id: "m-a" }, { id: "m-b" }] },
    ];
    const pricing = {
      model: { "m-a": { input: 1 }, "ghost-model": { input: 2 } },
      provider: {},
      pattern: [{ pattern: "never-matches-*", pricing: { input: 1 } }],
    };
    const findings = await localAudit(registry, FORMATS, pricing);
    expect(findings.some((f) => /duplicate model id "m-a"/.test(f))).toBe(true);
    expect(findings.some((f) => /MODEL_PRICING\["ghost-model"\]/.test(f))).toBe(true);
    expect(findings.some((f) => /PATTERN_PRICING "never-matches-\*"/.test(f))).toBe(true);
  });

  it("flags empty/non-string ids and bad targetFormat", async () => {
    const registry = [
      { id: "demo", models: [{ id: "" }, { id: 42 }, { id: "ok", targetFormat: "bogus-format" }] },
    ];
    const findings = await localAudit(registry, FORMATS, { model: {}, provider: {}, pattern: [] });
    expect(findings.some((f) => /empty\/non-string id/.test(f))).toBe(true);
    expect(findings.some((f) => /targetFormat "bogus-format" not in FORMATS/.test(f))).toBe(true);
  });

  it("flags upstreamModelId that resolves to no id in the same provider", async () => {
    const registry = [{ id: "demo", models: [{ id: "child", upstreamModelId: "missing-parent" }] }];
    const findings = await localAudit(registry, FORMATS, { model: {}, provider: {}, pattern: [] });
    expect(findings.some((f) => /upstreamModelId "missing-parent" resolves to no id/.test(f))).toBe(true);
  });

  it("resolves PROVIDER_PRICING keyed by alias (not falsely orphan)", async () => {
    const registry = [{ id: "github", alias: "gh", models: [{ id: "gpt-5.3-codex" }] }];
    const pricing = { model: {}, provider: { gh: { "gpt-5.3-codex": { input: 1 } } }, pattern: [] };
    const findings = await localAudit(registry, FORMATS, pricing);
    expect(findings.some((f) => /PROVIDER_PRICING\.gh/.test(f))).toBe(false);
  });

  it("flags PROVIDER_PRICING override for a model absent from THAT provider", async () => {
    const registry = [
      { id: "github", alias: "gh", models: [{ id: "gpt-5.3-codex" }] },
      { id: "other", models: [{ id: "only-here" }] },
    ];
    const pricing = { model: {}, provider: { gh: { "only-here": { input: 1 } } }, pattern: [] };
    const findings = await localAudit(registry, FORMATS, pricing);
    expect(findings.some((f) => /PROVIDER_PRICING\.gh\["only-here"\] matches no model id in that provider/.test(f))).toBe(true);
  });

  it("flags PROVIDER_PRICING for a provider key with no matching id/alias", async () => {
    const findings = await localAudit(
      [{ id: "demo", models: [{ id: "m" }] }],
      FORMATS,
      { model: {}, provider: { nope: { m: { input: 1 } } }, pattern: [] }
    );
    expect(findings.some((f) => /PROVIDER_PRICING\.nope — provider key matches no registry id\/alias/.test(f))).toBe(true);
  });

  it("clean registry + pricing yields no findings", async () => {
    const registry = [
      { id: "demo", models: [{ id: "m-a", targetFormat: "openai" }, { id: "m-b", upstreamModelId: "m-a" }] },
    ];
    const pricing = {
      model: { "m-a": { input: 1 } },
      provider: {},
      pattern: [{ pattern: "m-*", pricing: { input: 1 } }],
    };
    expect(await localAudit(registry, FORMATS, pricing)).toEqual([]);
  });

  it("allows same id across distinct kinds but flags same id within the same kind", async () => {
    // Gemini shape: a chat id reused for stt is fine; two rows of the same
    // (id, kind) pair are a genuine duplicate and must still be reported.
    const crossKind = [
      {
        id: "gemini",
        models: [
          { id: "gemini-2.5-pro" },
          { id: "gemini-2.5-pro", kind: "stt" },
          { id: "gemini-2.5-flash" },
          { id: "gemini-2.5-flash", kind: "stt" },
        ],
      },
    ];
    expect(
      await localAudit(crossKind, FORMATS, { model: {}, provider: {}, pattern: [] })
    ).toEqual([]);

    const sameKind = [
      {
        id: "gemini",
        models: [
          { id: "gemini-3.1-flash-tts-preview", kind: "tts" },
          { id: "gemini-3.1-flash-tts-preview", kind: "tts" },
        ],
      },
    ];
    const findings = await localAudit(sameKind, FORMATS, { model: {}, provider: {}, pattern: [] });
    expect(
      findings.some((f) => /duplicate model id "gemini-3.1-flash-tts-preview", kind "tts"/.test(f))
    ).toBe(true);
  });
});

describe("renderReport", () => {
  const ours = new Map([
    ["codex", new Set(["gpt-5.5", "gpt-5.4"])],
    ["github", new Set(["claude-sonnet-5"])],
  ]);
  const upstream = new Map([
    ["codex", new Set(["gpt-5.5", "gpt-5.6-sol"])],
  ]);
  const omniroute = new Map([
    ["github", new Set(["claude-sonnet-5", "claude-fable-5"])],
  ]);
  const shas = {
    ours: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    upstream: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    omniroute: "cccccccccccccccccccccccccccccccccccccccc",
  };
  const refs = { upstream: "upstream/master", omniroute: "omniroute/main" };

  it("pins exact SHAs in the header", () => {
    const { markdown } = renderReport({ ours, upstream, omniroute, shas, refs });
    expect(markdown).toMatch(/ours \(HEAD\): `a{40}`/);
    expect(markdown).toMatch(/upstream \(upstream\/master\): `b{40}`/);
    expect(markdown).toMatch(/omniroute \(omniroute\/main\): `c{40}`/);
  });

  it("emits expected per-provider rows with ✓/✗", () => {
    const { markdown } = renderReport({ ours, upstream, omniroute, shas, refs });
    expect(markdown).toMatch(/\| `gpt-5.6-sol` \| ✗ \| ✓ \| ✗ \|/);     // upstream-only (omniroute supplied, codex absent → ✗)
    expect(markdown).toMatch(/\| `claude-fable-5` \| ✗ \| ✗ \| ✓ \|/);  // omniroute-only (upstream supplied, github absent → ✗)
    expect(markdown).toMatch(/\| `claude-sonnet-5` \| ✓ \| ✗ \| ✓ \|/); // ours + omniroute
    expect(markdown).toMatch(/\| `gpt-5.5` \| ✓ \| ✓ \| ✗ \|/);         // ours + upstream
  });

  it("collects missing-here entries present upstream/omniroute but absent in ours", () => {
    const { missingHere } = renderReport({ ours, upstream, omniroute, shas, refs });
    expect(missingHere).toEqual(
      expect.arrayContaining([
        { provider: "codex", id: "gpt-5.6-sol" },
        { provider: "github", id: "claude-fable-5" },
      ])
    );
    expect(missingHere).not.toEqual(expect.arrayContaining([{ provider: "codex", id: "gpt-5.5" }]));
  });

  it("no-foreign-refs run shows em-dashes and empty missing-here", () => {
    const { markdown, missingHere } = renderReport({ ours, shas: { ours: shas.ours } });
    expect(markdown).toMatch(/\| `gpt-5.5` \| ✓ \| — \| — \|/);
    expect(missingHere).toEqual([]);
    expect(markdown).toMatch(/None — or no comparison refs supplied\./);
  });
});

describe("comparisonReport", () => {
  it("errors cleanly when a comparison ref is missing", async () => {
    await expect(comparisonReport("definitely-not-a-ref-xyz", null)).rejects.toThrow(/ref not found/);
  });

  // The live-tree path spawns Git and extracts the full provider catalog. It is
  // normally fast in isolation but can slow sharply while the complete suite
  // is saturating workers, so keep a bounded 30 s integration budget.
  it("renders pinned HEAD SHA and table header against the live tree", async () => {
    const md = await comparisonReport(null, null);
    expect(md).toMatch(/# Model Catalog Report/);
    expect(md).toMatch(/ours \(HEAD\): `[0-9a-f]{40}`/);
    expect(md).toMatch(/\| model id \| ours \| upstream \| omniroute \|/);
  }, 30_000);
});
