import { afterEach, describe, expect, it, vi } from "vitest";
import zed from "../../open-sse/providers/registry/zed.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { generateAuthData } from "../../src/lib/oauth/providers.js";
import { claimOAuthFlow, clearOAuthFlowsForTests, createOAuthFlow } from "../../src/lib/oauth/flowStore.js";

afterEach(() => {
  clearOAuthFlowsForTests();
  vi.unstubAllGlobals();
});

describe("Zed identity and current hosted support", () => {
  it("keeps Zed IDE import metadata distinct from hosted inference", () => {
    expect(zed).toMatchObject({ id: "zed", hidden: true, transport: null, models: [] });
    expect(resolveProviderAlias("zd")).toBe("zed");
    expect(resolveProviderAlias("zed-hosted")).toBe("zed-hosted");
  });

  it("starts the hosted native-app sign-in without outbound traffic, and keeps the IDE entry out of OAuth", async () => {
    const fetch = vi.fn(() => { throw new Error("Unexpected outbound request"); });
    vi.stubGlobal("fetch", fetch);
    const auth = await generateAuthData("zed-hosted", "http://127.0.0.1:3000/callback");
    // Zed's native-app flow: the public half of a fresh RSA key goes out, the private half stays
    // server-side where PKCE would keep its verifier, and the redirect is the loopback it reports.
    expect(new URL(auth.authUrl).origin + new URL(auth.authUrl).pathname).toBe("https://zed.dev/native_app_signin");
    expect(auth.codeVerifier).toMatch(/^zed-rsa-pkcs1:[A-Za-z0-9_-]{100,}/);
    expect(auth.redirectUri).toBe("http://127.0.0.1:3000/");
    expect(auth.meta).toEqual({ systemId: expect.any(String) });
    expect(auth.authUrl).not.toContain(auth.codeVerifier);
    expect(fetch).not.toHaveBeenCalled();
    // The Zed IDE key-import entry has no sign-in of its own.
    await expect(generateAuthData("zed", "http://127.0.0.1:3000/callback")).rejects.toThrow("Unknown provider: zed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("binds synthetic hosted and IDE flow secrets to their own provider", () => {
    const hosted = createOAuthFlow({ provider: "zed-hosted", state: "fixture-hosted", payload: { codeVerifier: "fixture-hosted-secret" } });
    const ide = createOAuthFlow({ provider: "zed", state: "fixture-ide", payload: { codeVerifier: "fixture-ide-secret" } });
    expect(claimOAuthFlow({ flowId: hosted.flowId, provider: "zed" })).toBeNull();
    expect(claimOAuthFlow({ flowId: ide.flowId, provider: "zed-hosted" })).toBeNull();
    expect(claimOAuthFlow({ flowId: hosted.flowId, provider: "zed-hosted" }).payload.codeVerifier).toBe("fixture-hosted-secret");
    expect(claimOAuthFlow({ flowId: ide.flowId, provider: "zed" }).payload.codeVerifier).toBe("fixture-ide-secret");
  });
});
