import { afterEach, describe, expect, it } from "vitest";
import {
  fetchProviderPluginManifest,
  getProviderPluginManifestEntryForModelFromManifest,
  PROVIDER_PLUGIN_MANIFEST_ENV,
  PROVIDER_PLUGIN_MANIFEST_PATH,
  resolveProviderPluginManifestUrl,
} from "../../open-sse/config/providerPluginManifestClient.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("provider plugin manifest client", () => {
  it("resolves explicit, environment, base, and default URLs", () => {
    process.env[PROVIDER_PLUGIN_MANIFEST_ENV] = "http://env.example/manifest";
    expect(resolveProviderPluginManifestUrl({ manifestUrl: "http://explicit.example/manifest" }))
      .toBe("http://explicit.example/manifest");
    expect(resolveProviderPluginManifestUrl({ baseUrl: "http://local.example:20128/" }))
      .toBe("http://env.example/manifest");

    delete process.env[PROVIDER_PLUGIN_MANIFEST_ENV];
    process.env.HOST = "0.0.0.0";
    process.env.PORT = "20129";
    expect(resolveProviderPluginManifestUrl({ baseUrl: "http://local.example:20128/" }))
      .toBe(`http://local.example:20128${PROVIDER_PLUGIN_MANIFEST_PATH}`);
    expect(resolveProviderPluginManifestUrl())
      .toBe(`http://0.0.0.0:20129${PROVIDER_PLUGIN_MANIFEST_PATH}`);
  });

  it("fetches and validates schemaVersion 1", async () => {
    const manifest = { schemaVersion: 1, generatedFrom: "test", providers: [] };
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(manifest), { status: 200 });
    };

    await expect(fetchProviderPluginManifest({
      manifestUrl: "http://sidecar.local/manifest",
      fetchImpl,
    })).resolves.toEqual(manifest);
    expect(calls[0].init.headers.Accept).toBe("application/json");
  });

  it("rejects failed HTTP and malformed manifest responses", async () => {
    await expect(fetchProviderPluginManifest({
      manifestUrl: "http://sidecar.local/manifest",
      fetchImpl: async () => new Response("nope", { status: 503 }),
    })).rejects.toThrow(/HTTP 503/);

    await expect(fetchProviderPluginManifest({
      manifestUrl: "http://sidecar.local/manifest",
      fetchImpl: async () => new Response(JSON.stringify({ providers: [] }), { status: 200 }),
    })).rejects.toThrow(/schemaVersion 1/);
  });

  it("resolves model entries by provider prefix, alias, or bare model id", () => {
    const manifest = {
      schemaVersion: 1,
      generatedFrom: "test",
      providers: [
        { id: "anthropic", alias: "claude", models: [{ id: "claude-sonnet-4.6" }] },
        { id: "openai", models: [{ id: "gpt-4.1" }] },
      ],
    };

    expect(getProviderPluginManifestEntryForModelFromManifest(manifest, "openai/gpt-4.1").id)
      .toBe("openai");
    expect(getProviderPluginManifestEntryForModelFromManifest(manifest, "claude/claude-sonnet-4.6").id)
      .toBe("anthropic");
    expect(getProviderPluginManifestEntryForModelFromManifest(manifest, "gpt-4.1").id)
      .toBe("openai");
  });

  it("prefers exact model-id matches before slash-prefix routing", () => {
    const manifest = {
      schemaVersion: 1,
      generatedFrom: "test",
      providers: [
        { id: "openai", models: [{ id: "gpt-4o-mini-tts" }] },
        { id: "openrouter", alias: "or", models: [{ id: "openai/gpt-4o-mini-tts" }] },
        { id: "meta", alias: "llama", models: [{ id: "meta/llama-3.1-8b-instruct" }] },
      ],
    };

    expect(getProviderPluginManifestEntryForModelFromManifest(manifest, "openai/gpt-4o-mini-tts").id)
      .toBe("openrouter");
    expect(getProviderPluginManifestEntryForModelFromManifest(manifest, "meta/llama-3.1-8b-instruct").id)
      .toBe("meta");
    expect(getProviderPluginManifestEntryForModelFromManifest(manifest, "openai/gpt-4.1").id)
      .toBe("openai");
  });

  it("resolves secondary aliases from manifest aliases", () => {
    const manifest = {
      schemaVersion: 1,
      generatedFrom: "test",
      providers: [
        { id: "deepseek", alias: "deepseek", aliases: ["ds"], models: [{ id: "deepseek-chat" }] },
        { id: "cloudflare-ai", alias: "cf", aliases: ["cloudflare-ai", "cloudflare"], models: [{ id: "llama-3.1" }] },
      ],
    };

    expect(getProviderPluginManifestEntryForModelFromManifest(manifest, "ds/deepseek-chat").id)
      .toBe("deepseek");
    expect(getProviderPluginManifestEntryForModelFromManifest(manifest, "cloudflare/llama-3.1").id)
      .toBe("cloudflare-ai");
  });
});
