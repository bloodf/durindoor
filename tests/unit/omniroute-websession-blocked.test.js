import { describe, expect, it } from "vitest";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "open-sse/providers/index.js";
import { parseModel } from "open-sse/services/model.js";
import { parseUpstreamError, createErrorResult } from "open-sse/utils/error.js";
import { checkFallbackError } from "open-sse/services/accountFallback.js";
import { getExecutor, hasSpecializedExecutor } from "open-sse/executors/index.js";
import {
  BLOCKED_OMNIROUTE_PROVIDERS,
  BLOCKED_OMNIROUTE_PROVIDER_ALIASES,
} from "open-sse/executors/unsupported-websession.js";
import { FREE_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers.js";

const ownedProviders = [
  "adapta-web",
  "chatgpt-web",
  "copilot-m365-web",
  "copilot-web",
  "duckduckgo-web",
  "huggingchat",
  "muse-spark-web",
  "suno",
  "t3-web",
  "udio",
  "veoaifree-web",
  "yuanbao-web",
];

describe("OmniRoute PR #51 web-session provider port artifacts", () => {
  it("registers every owned provider with source catalog metadata", () => {
    for (const provider of ownedProviders) {
      expect(PROVIDERS[provider], `${provider} transport`).toBeTruthy();
      expect(PROVIDER_MODELS[provider] || PROVIDER_MODELS[providerAlias(provider)], `${provider} models`).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: expect.any(String), name: expect.any(String) })]),
      );
      expect(BLOCKED_OMNIROUTE_PROVIDERS[provider], `${provider} blocker`).toMatchObject({
        reason: expect.any(String),
        source: expect.any(Array),
      });
    }
  });

  it("marks no-auth web providers and media-only providers explicitly", () => {
    expect(PROVIDERS["duckduckgo-web"]).toMatchObject({ noAuth: true, authType: "none" });
    expect(PROVIDERS["veoaifree-web"]).toMatchObject({ noAuth: true, authType: "none" });
    expect(FREE_PROVIDERS["duckduckgo-web"]).toMatchObject({ noAuth: true });
    expect(FREE_PROVIDERS["veoaifree-web"]).toMatchObject({ noAuth: true });

    expect(PROVIDER_MEDIA.suno).toMatchObject({ serviceKinds: ["music"], musicConfig: expect.any(Object) });
    expect(PROVIDER_MEDIA.udio).toMatchObject({ serviceKinds: ["music"], musicConfig: expect.any(Object) });
    expect(PROVIDER_MEDIA["veoaifree-web"]).toMatchObject({ serviceKinds: ["video"], videoConfig: expect.any(Object) });
    expect(PROVIDER_MEDIA["chatgpt-web"]).toMatchObject({ serviceKinds: ["llm"], imageConfig: expect.any(Object) });
  });

  it("excludes port-pending web providers from kind selectors they cannot currently serve", () => {
    expect(getProvidersByKind("image").map((p) => p.id)).not.toContain("chatgpt-web");
    expect(getProvidersByKind("music").map((p) => p.id)).not.toContain("suno");
    expect(getProvidersByKind("music").map((p) => p.id)).not.toContain("udio");
    expect(getProvidersByKind("video").map((p) => p.id)).not.toContain("veoaifree-web");
  });

  it("resolves uiAlias tokens to the guarded provider in model strings", () => {
    expect(parseModel("m365/copilot-m365")).toMatchObject({ provider: "copilot-m365-web", model: "copilot-m365" });
    expect(parseModel("copilot/copilot-pro")).toMatchObject({ provider: "copilot-web", model: "copilot-pro" });
    expect(parseModel("ddg/gpt-4o-mini")).toMatchObject({ provider: "duckduckgo-web", model: "gpt-4o-mini" });
    expect(parseModel("t3/claude-opus-4")).toMatchObject({ provider: "t3-web", model: "claude-opus-4" });
  });

  it("preserves structured provider_port_pending error body through the upstream error parser", async () => {
    const executor = getExecutor("veoaifree-web");
    const { response } = await executor.execute({});
    const parsed = await parseUpstreamError(response, executor);
    expect(parsed.statusCode).toBe(501);
    expect(parsed.message).toContain("runtime execution is not ported yet");
    expect(parsed.errorBody).toMatchObject({
      error: {
        type: "provider_port_pending",
        provider: "veoaifree-web",
        sourceFiles: expect.any(Array),
      },
    });
    const result = createErrorResult(parsed.statusCode, parsed.message, undefined, parsed.errorBody);
    const body = await result.response.json();
    expect(body).toEqual(parsed.errorBody);
    expect(body.error.type).toBe("provider_port_pending");
    expect(body.error.sourceFiles).toEqual(expect.any(Array));
  });

  it("does not trigger account fallback for provider_port_pending errors", () => {
    expect(checkFallbackError(501, '{"error":{"type":"provider_port_pending"}}')).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("uses an explicit unsupported executor instead of silently falling back to default OpenAI transport", async () => {
    for (const provider of ownedProviders) {
      expect(hasSpecializedExecutor(provider), `${provider} specialized executor`).toBe(true);
      const result = await getExecutor(provider).execute({});
      expect(result.response.status, `${provider} status`).toBe(501);
      const body = await result.response.json();
      expect(body.error).toMatchObject({
        type: "provider_port_pending",
        provider,
        sourceFiles: expect.any(Array),
      });
      expect(body.error.message).toContain("runtime execution is not ported yet");
    }
  });

  it("routes published aliases to the same unsupported executor guard", async () => {
    for (const [alias, provider] of Object.entries(BLOCKED_OMNIROUTE_PROVIDER_ALIASES)) {
      expect(hasSpecializedExecutor(alias), `${alias} specialized executor`).toBe(true);
      const result = await getExecutor(alias).execute({});
      expect(result.response.status, `${alias} status`).toBe(501);
      const body = await result.response.json();
      expect(body.error).toMatchObject({
        type: "provider_port_pending",
        provider,
      });
    }
  });
});

function providerAlias(provider) {
  return {
    "adapta-web": "adp-web",
    "chatgpt-web": "cgpt-web",
    "copilot-m365-web": "m365copilot",
    "duckduckgo-web": "ddgw",
    "muse-spark-web": "ms-web",
    "t3-web": "t3chat",
    "veoaifree-web": "veo-free",
    "yuanbao-web": "ybw",
  }[provider] || provider;
}
