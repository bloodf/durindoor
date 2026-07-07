import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { OpenCodeZenExecutor } from "../../open-sse/executors/opencode-zen.js";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

const repoRoot = resolve(import.meta.dirname, "../..");

const requestedProviderIds = [
  "9router",
  "auto",
  "codex-cloud",
  "docker-model-runner",
  "lemonade",
  "llama-cpp",
  "llamafile",
  "lm-studio",
  "oobabooga",
  "opencode-zen",
  "triton",
  "vllm",
  "xinference",
  "zed",
];

const importedRegistryProviderIds = [
  "kenari",
  "nube",
];

const byId = Object.fromEntries(REGISTRY.map((entry) => [entry.id, entry]));

describe("OmniRoute Batch G local/router provider parity", () => {
  it("registers every requested provider id with preserved aliases", () => {
    for (const id of requestedProviderIds) {
      expect(byId[id], `${id} should be present in registry/index.js`).toBeTruthy();
      expect(byId[id].alias || id, `${id} should preserve its registry alias`).toBeTruthy();
      if (byId[id].transport) {
        expect(PROVIDER_ID_TO_ALIAS[id], `${id} should have a runtime alias map entry`).toBe(byId[id].alias || id);
      }
    }

    expect(PROVIDER_ID_TO_ALIAS["llama-cpp"]).toBe("llamacpp");
    expect(PROVIDER_ID_TO_ALIAS["docker-model-runner"]).toBe("dmr");
    expect(byId.zed.alias).toBe("zd");
    expect(PROVIDER_ID_TO_ALIAS["9router"]).toBe("nr");
  });

  it("exports imported registry modules that previously regressed out of the registry array", () => {
    for (const id of importedRegistryProviderIds) {
      expect(byId[id], `${id} should be present in registry/index.js export array`).toBeTruthy();
      expect(byId[id].id).toBe(id);
    }
  });

  it("preserves local OpenAI-compatible defaults and passthrough model behavior", () => {
    const localDefaults = {
      "lm-studio": "http://localhost:1234/v1",
      vllm: "http://localhost:8000/v1",
      lemonade: "http://localhost:13305/api/v1",
      llamafile: "http://127.0.0.1:8080/v1",
      "llama-cpp": "http://127.0.0.1:8080/v1",
      triton: "http://localhost:8000/v1",
      "docker-model-runner": "http://localhost:12434/v1",
      xinference: "http://localhost:9997/v1",
      oobabooga: "http://localhost:5000/v1",
    };

    for (const [id, baseUrl] of Object.entries(localDefaults)) {
      expect(byId[id].transport).toMatchObject({ baseUrl, format: "openai" });
      expect(byId[id].noAuth).toBe(true);
      expect(byId[id].passthroughModels).toBe(true);
      expect(new DefaultExecutor(id).buildUrl("custom", true, 0, {})).toBe(`${baseUrl}/chat/completions`);
      expect(new DefaultExecutor(id).buildUrl("custom", true, 0, {
        providerSpecificData: { baseUrl: "http://host.docker.internal:9000/v1/" },
      })).toBe("http://host.docker.internal:9000/v1/chat/completions");
    }
  });

  it("omits Authorization for optional local providers when credentials are empty", () => {
    for (const id of ["lm-studio", "vllm", "lemonade", "llamafile", "llama-cpp", "triton", "docker-model-runner", "xinference", "oobabooga", "9router"]) {
      const headers = new DefaultExecutor(id).buildHeaders({}, true);
      expect(headers.Authorization, `${id} should not send an empty bearer token`).toBeUndefined();
    }

    expect(new DefaultExecutor("lm-studio").buildHeaders({ apiKey: "local-key" }, true).Authorization).toBe(
      "Bearer local-key",
    );
  });

  it("ports router/system/cloud metadata without exposing fake runtime transports", () => {
    expect(byId["9router"].transport.baseUrl).toBe("http://127.0.0.1:20130/v1");
    expect(byId["9router"].noAuth).toBe(true);
    expect(byId["9router"].passthroughModels).toBe(true);
    expect(new DefaultExecutor("9router").buildUrl("auto", true, 0, {})).toBe(
      "http://127.0.0.1:20130/v1/chat/completions",
    );

    expect(byId.auto).toMatchObject({ category: "system", transport: null });
    expect(PROVIDER_MODELS.auto).toBeUndefined();
    expect(byId["codex-cloud"]).toMatchObject({ category: "apikey", transport: null, hidden: true });
    expect(byId.zed).toMatchObject({ category: "oauth", transport: null, hidden: true });
  });

  it("keeps the OpenCode Zen catalog and local source icon assets", () => {
    const opencodeZen = byId["opencode-zen"];
    expect(opencodeZen.transport.baseUrl).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(opencodeZen.models.map((model) => model.id)).toEqual([
      "big-pickle",
      "gpt-5-nano",
      "gpt-5",
      "gpt-5-codex",
      "gpt-5.1",
      "gpt-5.1-codex",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.4-pro",
      "gpt-5.5",
      "gpt-5.5-pro",
      "claude-haiku-4-5",
      "claude-sonnet-4",
      "claude-sonnet-4-5",
      "claude-sonnet-4-6",
      "claude-opus-4-1",
      "claude-opus-4-5",
      "claude-opus-4-6",
      "claude-opus-4-7",
      "gemini-3-flash",
      "gemini-3.1-pro",
      "gemini-3.5-flash",
      "grok-build-0.1",
      "glm-5",
      "glm-5.1",
      "minimax-m3",
      "minimax-m2.5",
      "minimax-m2.7",
      "kimi-k2.5",
      "kimi-k2.6",
      "qwen3.5-plus",
      "qwen3.6-plus",
      "deepseek-v4-flash-free",
      "minimax-m2.5-free",
      "nemotron-3-super-free",
      "qwen3.6-plus-free",
    ]);
    expect(PROVIDER_MODELS["opencode-zen"]).toHaveLength(opencodeZen.models.length);
    expect(PROVIDER_MODELS["opencode-zen"].find((model) => model.id === "gpt-5.2").targetFormat).toBe("openai-responses");
    expect(PROVIDER_MODELS["opencode-zen"].find((model) => model.id === "qwen3.6-plus").targetFormat).toBe("claude");

    for (const icon of [
      "docker-model-runner.svg",
      "lemonade.png",
      "llamafile.png",
      "opencode.svg",
      "opencode-light.svg",
      "opencode-dark.svg",
    ]) {
      expect(existsSync(resolve(repoRoot, "public/providers", icon)), `${icon} should exist`).toBe(true);
    }
  });

  it("routes OpenCode Zen models by API family", () => {
    const executor = new OpenCodeZenExecutor();

    expect(executor.buildUrl("qwen3.6-plus")).toBe("https://opencode.ai/zen/v1/messages");
    let headers = executor.buildHeaders({ apiKey: "sk-test" }, false);
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBeDefined();
    expect(headers.Authorization).toBeUndefined();

    expect(executor.buildUrl("gpt-5.2")).toBe("https://opencode.ai/zen/v1/responses");
    headers = executor.buildHeaders({ apiKey: "sk-test" }, false);
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["x-api-key"]).toBeUndefined();

    expect(executor.buildUrl("glm-5")).toBe("https://opencode.ai/zen/v1/chat/completions");
  });
});
