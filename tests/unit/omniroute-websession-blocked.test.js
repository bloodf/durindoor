import { describe, expect, it } from "vitest";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "open-sse/providers/index.js";
import { getExecutor, hasSpecializedExecutor } from "open-sse/executors/index.js";
import {
  BLOCKED_OMNIROUTE_PROVIDERS,
  BLOCKED_OMNIROUTE_PROVIDER_ALIASES,
} from "open-sse/executors/unsupported-websession.js";
import { FREE_PROVIDERS } from "@/shared/constants/providers.js";

const ownedProviders = [
  "copilot-m365-web",
  "copilot-web",
  "suno",
  "udio",
];

const implementedProviders = [
  "adapta-web",
  "chatgpt-web",
  "duckduckgo-web",
  "huggingchat",
  "muse-spark-web",
  "t3-web",
  "veoaifree-web",
  "yuanbao-web",
];

describe("OmniRoute PR #51 web-session provider port artifacts", () => {
  it("registers every owned provider with source catalog metadata", () => {
    for (const provider of [...ownedProviders, ...implementedProviders]) {
      expect(PROVIDERS[provider], `${provider} transport`).toBeTruthy();
      expect(PROVIDER_MODELS[provider] || PROVIDER_MODELS[providerAlias(provider)], `${provider} models`).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: expect.any(String), name: expect.any(String) })]),
      );
    }
    for (const provider of ownedProviders) {
      expect(BLOCKED_OMNIROUTE_PROVIDERS[provider], `${provider} blocker`).toMatchObject({
        reason: expect.any(String),
        source: expect.any(Array),
      });
    }
  });

  it("uses concrete executors for runtime-ported web/session providers", () => {
    for (const provider of implementedProviders) {
      expect(hasSpecializedExecutor(provider), `${provider} specialized executor`).toBe(true);
      expect(BLOCKED_OMNIROUTE_PROVIDERS[provider], `${provider} no longer blocked`).toBeUndefined();
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
    expect(PROVIDER_MEDIA["chatgpt-web"]).toMatchObject({ serviceKinds: ["llm", "image"], imageConfig: expect.any(Object) });
  });

  it("registers ported web/session/media executors without provider_port_pending", async () => {
    for (const provider of implementedProviders) {
      expect(BLOCKED_OMNIROUTE_PROVIDERS[provider], `${provider} no blocker`).toBeUndefined();
      expect(hasSpecializedExecutor(provider), `${provider} specialized executor`).toBe(true);
      const result = await getExecutor(provider).execute({});
      expect(result.response.status, `${provider} status`).not.toBe(501);
      const body = await result.response.json();
      expect(body.error?.type, `${provider} error type`).not.toBe("provider_port_pending");
    }
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

  it("routes ported aliases to concrete executors", async () => {
    for (const alias of ["adp-web", "cgpt-web", "ddgw", "ms-web", "t3chat", "veo-free", "ybw"]) {
      expect(hasSpecializedExecutor(alias), `${alias} specialized executor`).toBe(true);
      const result = await getExecutor(alias).execute({});
      expect(result.response.status, `${alias} status`).not.toBe(501);
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
