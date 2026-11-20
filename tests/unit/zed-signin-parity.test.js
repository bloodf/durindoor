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

  it("rejects the currently unsupported hosted sign-in without outbound traffic", async () => {
    const fetch = vi.fn(() => { throw new Error("Unexpected outbound request"); });
    vi.stubGlobal("fetch", fetch);
    await expect(generateAuthData("zed-hosted", "http://127.0.0.1:3000/callback"))
      .rejects.toThrow("Unknown provider: zed-hosted");
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
