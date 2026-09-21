import { describe, it, expect } from "vitest";
import { buildRegistryProviderProbe } from "../../src/app/api/providers/providerProbe.js";

/**
 * A registry-declared `validateUrl` is a dedicated key-check endpoint,
 * independent of the provider's chat transport format. Before this fix,
 * `buildRegistryProviderProbe` only honored `validateUrl` for providers with
 * `format: "openai"`, so a provider like perplexity-agent
 * (`format: "openai-responses"`, `validateUrl` set) hit the `cfg.format !==
 * "openai"` early return and fell all the way through to "Provider test not
 * supported" despite the registry already knowing how to test it.
 */
describe("registry-declared validateUrl honored regardless of chat format", () => {
  it("builds a probe for a non-openai format that still declares validateUrl", () => {
    const probe = buildRegistryProviderProbe("perplexity-agent", "test-key");

    expect(probe).not.toBeNull();
    expect(probe.url).toBe("https://api.perplexity.ai/v1/models");
    expect(probe.options.headers.Authorization).toBe("Bearer test-key");
    expect(probe.accepts).toBe("ok");
  });

  it("omits the chat-body fallback for non-openai formats", () => {
    const probe = buildRegistryProviderProbe("perplexity-agent", "test-key");
    expect(probe.fallback).toBeUndefined();
  });

  it("still includes the chat-body fallback for plain openai-format providers", () => {
    const probe = buildRegistryProviderProbe("tokenrouter", "test-key");
    expect(probe.fallback).toBeDefined();
    expect(probe.fallback.url).toBe("https://api.tokenrouter.com/v1/chat/completions");
  });
});
