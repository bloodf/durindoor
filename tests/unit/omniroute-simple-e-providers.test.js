import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DefaultExecutor, normalizeAccountIdPlaceholder } from "../../open-sse/executors/default.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { buildRegistryProviderProbe, probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

const repoRoot = resolve(import.meta.dirname, "../..");

const OWNED_PROVIDERS = [
  "qianfan",
  "qiniu",
  "reka",
  "requesty",
  "sambanova",
  "scaleway",
  "sensenova",
  "snowflake",
  "sparkdesk",
  "stepfun",
  "sumopod",
  "synthetic",
  "tencent",
  "tokenrouter",
  "uncloseai",
  "upstage",
  "v0-vercel",
  "volcengine",
  "wafer",
  "wandb",
  "x5lab",
  "yi",
  "zai",
  "zenmux",
];

const EXPECTED_TRANSPORT = {
  qianfan: {
    baseUrl: "https://qianfan.baidubce.com/v2/chat/completions",
    validateUrl: "https://qianfan.baidubce.com/v2/models",
    defaultContextLength: 128000,
    modelsUrl: "https://qianfan.baidubce.com/v2/models",
  },
  qiniu: {
    baseUrl: "https://api.qnaigc.com/v1/chat/completions",
    validateUrl: "https://api.qnaigc.com/v1/models",
    defaultContextLength: 128000,
    modelsUrl: "https://api.qnaigc.com/v1/models",
    passthroughModels: true,
  },
  snowflake: {
    baseUrl: "https://{accountId}.snowflakecomputing.com/api/v2/cortex/v1/chat/completions",
  },
  requesty: {
    baseUrl: "https://router.requesty.ai/v1/chat/completions",
    validateUrl: "https://router.requesty.ai/v1/models",
    modelsUrl: "https://router.requesty.ai/v1/models",
    passthroughModels: true,
  },
  sumopod: {
    baseUrl: "https://ai.sumopod.com/v1/chat/completions",
    validateUrl: "https://ai.sumopod.com/v1/models",
    defaultContextLength: 128000,
    modelsUrl: "https://ai.sumopod.com/v1/models",
    passthroughModels: true,
  },
  synthetic: {
    baseUrl: "https://api.synthetic.new/openai/v1/chat/completions",
    validateUrl: "https://api.synthetic.new/openai/v1/models",
    modelsUrl: "https://api.synthetic.new/openai/v1/models",
    passthroughModels: true,
  },
  tokenrouter: {
    baseUrl: "https://api.tokenrouter.com/v1/chat/completions",
    validateUrl: "https://api.tokenrouter.com/v1/models",
    defaultContextLength: 128000,
    modelsUrl: "https://api.tokenrouter.com/v1/models",
  },
  x5lab: {
    baseUrl: "https://api.x5lab.dev/v1/chat/completions",
    validateUrl: "https://api.x5lab.dev/v1/models",
    defaultContextLength: 128000,
    modelsUrl: "https://api.x5lab.dev/v1/models",
    passthroughModels: true,
  },
  zenmux: {
    baseUrl: "https://zenmux.ai/api/v1/chat/completions",
    validateUrl: "https://zenmux.ai/api/v1/models",
    defaultContextLength: 128000,
    modelsUrl: "https://zenmux.ai/api/v1/models",
  },
};

const EXPECTED_ICON_FILES = [
  "qianfan.svg",
  "reka.png",
  "scaleway.svg",
  "sensenova.svg",
  "sparkdesk.svg",
  "stepfun.svg",
  "synthetic.svg",
  "tencent.svg",
  "wandb.svg",
  "yi.svg",
];

const EXPECTED_SVG_ICON_URLS = [
  "qianfan",
  "scaleway",
  "sensenova",
  "sparkdesk",
  "stepfun",
  "synthetic",
  "tencent",
  "wandb",
  "yi",
];

const registryById = new Map(REGISTRY.map((entry) => [entry.id, entry]));
const addApiKeyModalSource = readFileSync(
  resolve(repoRoot, "src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js"),
  "utf8",
);
const editConnectionModalSource = readFileSync(
  resolve(repoRoot, "src/shared/components/EditConnectionModal.js"),
  "utf8",
);
const providerValidateRouteSource = readFileSync(
  resolve(repoRoot, "src/app/api/providers/validate/route.js"),
  "utf8",
);

describe("OmniRoute simple/default providers batch E", () => {
  it("registers every owned provider id exactly once", () => {
    for (const providerId of OWNED_PROVIDERS) {
      expect(registryById.get(providerId), `${providerId} should be in the registry`).toBeTruthy();
    }

    const ids = REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("preserves OmniRoute transport URLs, model URLs, and passthrough flags", () => {
    for (const [providerId, expected] of Object.entries(EXPECTED_TRANSPORT)) {
      const entry = registryById.get(providerId);
      expect(entry.transport.baseUrl).toBe(expected.baseUrl);
      if (expected.validateUrl) {
        expect(entry.transport.validateUrl).toBe(expected.validateUrl);
      }
      if (expected.modelsUrl) {
        expect(entry.modelsFetcher).toEqual({ url: expected.modelsUrl, type: "openai" });
      }
      if (expected.defaultContextLength) {
        expect(entry.defaultContextLength).toBe(expected.defaultContextLength);
      }
      if (expected.passthroughModels) {
        expect(entry.passthroughModels).toBe(true);
      }
    }
  });

  it("normalizes OpenAI-compatible fetched model catalogs", () => {
    expect(
      FILTERS.openai([
        { id: "qnaigc/deepseek-v3", name: "DeepSeek V3", context_length: 128000 },
        { id: "llama-bare-model" },
        { id: "" },
        { name: "missing id" },
      ]),
    ).toEqual([
      { id: "qnaigc/deepseek-v3", name: "DeepSeek V3", contextLength: 128000 },
      { id: "llama-bare-model", name: "llama-bare-model" },
    ]);
  });

  it("builds registry connection probes for OpenAI-compatible simple providers", async () => {
    const probe = buildRegistryProviderProbe("qiniu", "test-key");
    expect(probe.url).toBe("https://api.qnaigc.com/v1/models");
    expect(probe.options.headers.Authorization).toBe("Bearer test-key");
    expect(probe.fallback.url).toBe("https://api.qnaigc.com/v1/chat/completions");

    const calls = [];
    const result = await probeRegistryProvider("qiniu", "test-key", async (url, options) => {
      calls.push([url, options]);
      return calls.length === 1 ? { ok: false, status: 500 } : { ok: false, status: 400 };
    });

    expect(result).toEqual({ valid: true, status: 400 });
    expect(calls.map(([url]) => url)).toEqual([
      "https://api.qnaigc.com/v1/models",
      "https://api.qnaigc.com/v1/chat/completions",
    ]);
    expect(JSON.parse(calls[1][1].body)).toMatchObject({ model: "test", max_tokens: 1 });
  });

  it("builds Claude-format registry validation probes for Wafer and Z.AI", async () => {
    const waferProbe = buildRegistryProviderProbe("wafer", "wafer-key");
    expect(waferProbe.url).toBe("https://pass.wafer.ai/v1/messages");
    expect(waferProbe.options.method).toBe("POST");
    expect(waferProbe.options.headers.Authorization).toBe("Bearer wafer-key");
    expect(waferProbe.options.headers["Anthropic-Version"]).toBe("2023-06-01");

    const zaiProbe = buildRegistryProviderProbe("zai", "zai-key");
    expect(zaiProbe.url).toBe("https://api.z.ai/api/anthropic/v1/messages?beta=true");
    expect(zaiProbe.options.headers["x-api-key"]).toBe("zai-key");
    expect(JSON.parse(zaiProbe.options.body)).toMatchObject({ model: "glm-5.2", max_tokens: 1 });

    expect(await probeRegistryProvider("zai", "zai-key", async () => ({ ok: false, status: 400 }))).toEqual({
      valid: true,
      status: 400,
    });
    expect(await probeRegistryProvider("wafer", "wafer-key", async () => ({ ok: false, status: 401 }))).toEqual({
      valid: false,
      status: 401,
    });
  });

  it("keeps Claude-format auth and headers for Wafer and Z.AI", () => {
    expect(registryById.get("wafer")).toMatchObject({
      transport: {
        baseUrl: "https://pass.wafer.ai/v1/messages",
        format: "claude",
        auth: { combined: true, header: "Authorization", scheme: "bearer" },
        headers: {
          "Anthropic-Version": "2023-06-01",
        },
      },
    });

    expect(registryById.get("zai")).toMatchObject({
      transport: {
        baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
        format: "claude",
        urlSuffix: "?beta=true",
        auth: { combined: true, header: "x-api-key", scheme: "raw" },
        headers: {
          "Anthropic-Version": "2023-06-01",
        },
      },
    });
  });

  it("resolves Snowflake accountId URLs through the default executor", () => {
    const entry = registryById.get("snowflake");
    expect(entry.hasProviderSpecificData).toBe(true);
    expect(entry.transport.baseUrl).not.toContain("{account}.");

    const executor = new DefaultExecutor("snowflake");
    const credentials = { providerSpecificData: { accountId: "org-account" } };
    expect(executor.buildUrl("claude-3-5-sonnet", true, 0, credentials)).toBe(
      "https://org-account.snowflakecomputing.com/api/v2/cortex/v1/chat/completions",
    );
    expect(() => executor.buildUrl("claude-3-5-sonnet", true, 0, { providerSpecificData: {} })).toThrow(
      "snowflake requires accountId in providerSpecificData",
    );
  });

  it("rejects accountId placeholder values that can escape the Snowflake host", () => {
    expect(normalizeAccountIdPlaceholder("snowflake", "org-account")).toBe("org-account");
    expect(normalizeAccountIdPlaceholder("cloudflare-ai", "abc123def456")).toBe("abc123def456");

    for (const accountId of [
      "attacker.example/path",
      "attacker.example:443",
      "token@attacker.example",
      "attacker.example?x=1",
      "attacker.example#frag",
      "attacker example",
    ]) {
      expect(() => normalizeAccountIdPlaceholder("snowflake", accountId), accountId).toThrow(
        "snowflake requires a valid accountId in providerSpecificData",
      );
    }
  });

  it("normalizes underscores in a Snowflake account identifier to hyphens before DNS validation", () => {
    // Documented Snowflake "dashed" hostname variant: orgname-account_name -> orgname-account-name
    expect(normalizeAccountIdPlaceholder("snowflake", "orgname-account_name")).toBe("orgname-account-name");
    expect(normalizeAccountIdPlaceholder("snowflake", "org_account")).toBe("org-account");

    const executor = new DefaultExecutor("snowflake");
    const credentials = { providerSpecificData: { accountId: "orgname-account_name" } };
    expect(executor.buildUrl("claude-3-5-sonnet", true, 0, credentials)).toBe(
      "https://orgname-account-name.snowflakecomputing.com/api/v2/cortex/v1/chat/completions",
    );
  });

  it("resolves the Snowflake accountId placeholder in registry connection-test probes", async () => {
    // Snowflake is openai-format (no explicit validateUrl) so the probe URL is
    // derived from baseUrl with the {accountId} placeholder already resolved,
    // and the fallback keeps the resolved host too.
    const probe = buildRegistryProviderProbe("snowflake", "test-token", { accountId: "org-account" });
    expect(probe.url).toBe("https://org-account.snowflakecomputing.com/api/v2/cortex/v1/models");
    expect(probe.fallback.url).toBe("https://org-account.snowflakecomputing.com/api/v2/cortex/v1/chat/completions");

    expect(() => buildRegistryProviderProbe("snowflake", "test-token", {})).toThrow(
      "snowflake requires accountId in providerSpecificData",
    );

    const calls = [];
    const result = await probeRegistryProvider(
      "snowflake",
      "test-token",
      async (url) => {
        calls.push(url);
        return { ok: true, status: 200 };
      },
      { accountId: "org-account" },
    );
    expect(calls).toEqual(["https://org-account.snowflakecomputing.com/api/v2/cortex/v1/models"]);
    expect(result).toEqual({ valid: true, status: 200 });
  });

  it("keeps Snowflake wired into Account ID connection forms", () => {
    for (const source of [addApiKeyModalSource, editConnectionModalSource]) {
      expect(source).toContain("ACCOUNT_ID_PROVIDER_DETAILS");
      expect(source).toContain("\"cloudflare-ai\"");
      expect(source).toContain("snowflake");
      expect(source).toContain("accountId");
    }
    expect(addApiKeyModalSource).toContain("providerSpecificData: buildProviderSpecificData()");
    expect(addApiKeyModalSource).toContain("requiresAccountId && parts.length >= 3");
    expect(addApiKeyModalSource).toContain("{requiresAccountId");
    expect(addApiKeyModalSource).toContain("requiresAccountId && !accountIdData.accountId");
    expect(addApiKeyModalSource).toContain("org-account");
  });

  it("keeps Snowflake validation accountId-aware", () => {
    expect(providerValidateRouteSource).toContain("provider === \"snowflake\"");
    expect(providerValidateRouteSource).toContain("${accountId}.snowflakecomputing.com");
    expect(providerValidateRouteSource).toContain("Missing Account ID");
  });

  it("keeps local icon assets for owned providers that have copied source icons", () => {
    for (const icon of EXPECTED_ICON_FILES) {
      expect(
        existsSync(resolve(repoRoot, "public/providers", icon)),
        `${icon} should be served from public/providers`,
      ).toBe(true);
    }
  });

  it("points SVG-only provider cards at their copied SVG icon assets", () => {
    for (const providerId of EXPECTED_SVG_ICON_URLS) {
      const iconUrl = `/providers/${providerId}.svg`;
      expect(registryById.get(providerId)?.display?.iconUrl).toBe(iconUrl);
      expect(AI_PROVIDERS[providerId]?.iconUrl).toBe(iconUrl);
    }
  });
});
