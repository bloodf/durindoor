// PR #48 review-thread coverage for OmniRoute simple-provider batch A.
// Scoped to api-airforce validateUrl: the generic OpenAI-compatible probe
// must hit the registry's explicit /v1/models instead of deriving it from
// the /v1/chat/completions baseUrl. The route change is verified by source
// assertion to keep this file dependency-free (no next/server/translator
// chain under vitest).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import apiAirforce from "../../open-sse/providers/registry/api-airforce.js";
import bailianCodingPlan from "../../open-sse/providers/registry/bailian-coding-plan.js";
import bai from "../../open-sse/providers/registry/bai.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("PR #48 review: api-airforce validateUrl", () => {
  it("registers a dedicated /v1/models probe endpoint", () => {
    expect(apiAirforce.transport?.validateUrl).toBe("https://api.airforce/v1/models");
    expect(PROVIDERS["api-airforce"]?.validateUrl).toBe("https://api.airforce/v1/models");
  });

  it("src/app/api/providers/validate/route.js prefers cfg.validateUrl in the generic OpenAI probe", () => {
    const source = readFileSync(
      resolve(repoRoot, "src/app/api/providers/validate/route.js"),
      "utf8",
    );
    expect(source).toMatch(/const\s+modelsUrl\s*=\s*cfg\.validateUrl\s*\|\|/);
    expect(source).toContain('case "bailian-coding-plan"');
    expect(source).toContain('provider === "bailian-coding-plan"');
    expect(source).toContain('"Authorization": `Bearer ${apiKey}`');
  });

  it("bailian-coding-plan registry uses bearer auth for dashboard keys", () => {
    expect(bailianCodingPlan.transport?.auth).toMatchObject({
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    });
    expect(PROVIDERS["bailian-coding-plan"]?.auth).toMatchObject({
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    });
  });

  it("bailian-coding-plan keeps thinking in Claude native format", () => {
    expect(PROVIDERS["bailian-coding-plan"]?.thinkingFormat).toBe("claude");
    expect(bailianCodingPlan.transport?.format).toBe("claude");
  });
});

describe("PR #48 review: bai suggested-models openai filter", () => {
  it("FILTERS.openai passes through string model ids and ignores object ids", () => {
    const result = FILTERS.openai([
      { id: "model-1", name: "Model 1", context_length: 12345 },
      { id: "", name: "Empty" },
      { id: 123, name: "Bad" },
      { id: { object: "model" }, name: "Also bad" },
      { id: "model-2", name: "Model 2" },
    ]);
    expect(result).toEqual([
      { id: "model-1", name: "Model 1", contextLength: 12345 },
      { id: "model-2", name: "Model 2" },
    ]);
  });

  it("bai registry declares an openai models fetcher", () => {
    expect(bai.modelsFetcher?.type).toBe("openai");
    expect(bai.modelsFetcher?.url).toBe("https://api.b.ai/v1/models");
  });

  it("bai uses the authenticated /api/providers/[id]/models config", () => {
    const source = readFileSync(
      resolve(repoRoot, "src/app/api/providers/[id]/models/modelsConfig.js"),
      "utf8",
    );
    expect(source).toContain('bai: createOpenAIModelsConfig("https://api.b.ai/v1/models")');
  });
});
