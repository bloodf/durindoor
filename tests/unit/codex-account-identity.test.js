import { describe, expect, it } from "vitest";
import {
  applyCodexAccountHeader,
  hasConflictingCodexAccountIds,
  resolveCodexAccountId,
} from "../../open-sse/shared/codexAccountId.js";
import codexImageProvider from "../../open-sse/handlers/imageProviders/codex.js";
import { mergeProviderConnection, mergeProviderSpecificData } from "../../src/lib/db/helpers/mergeProviderMetadata.js";

describe("Codex account identity", () => {
  it("resolves legacy aliases in stable precedence and ignores invalid values", () => {
    expect(resolveCodexAccountId({ workspaceId: " workspace ", chatgptAccountId: "chatgpt", accountId: "legacy" })).toBe("workspace");
    expect(resolveCodexAccountId({ workspaceId: " ", chatgptAccountId: " chatgpt " })).toBe("chatgpt");
    expect(resolveCodexAccountId({ workspaceId: 42, accountId: " legacy " })).toBe("legacy");
    expect(resolveCodexAccountId({ workspaceId: "bad\nheader" })).toBe("");
    expect(resolveCodexAccountId(null)).toBe("");
  });

  it("detects conflicting aliases and preserves a caller header case-insensitively", () => {
    expect(hasConflictingCodexAccountIds({ workspaceId: "a", chatgptAccountId: "b" })).toBe(true);
    expect(hasConflictingCodexAccountIds({ workspaceId: "a", accountId: "a" })).toBe(false);
    const headers = { "chatgpt-account-id": "caller" };
    applyCodexAccountHeader(headers, { workspaceId: "credential" });
    expect(headers).toEqual({ "chatgpt-account-id": "caller" });
  });

  it("uses the shared resolver for image requests and omits missing bindings", () => {
    const bound = codexImageProvider.buildHeaders({ accessToken: "token", providerSpecificData: { accountId: " legacy " } });
    const unbound = codexImageProvider.buildHeaders({ accessToken: "token", providerSpecificData: {} });
    expect(bound["chatgpt-account-id"]).toBe("legacy");
    expect(unbound).not.toHaveProperty("chatgpt-account-id");
  });

  it("deep-merges metadata safely and retains omitted token fields", () => {
    const merged = mergeProviderConnection({
      accessToken: "old-access", refreshToken: "old-refresh", idToken: "old-id",
      providerSpecificData: { proxy: { host: "old", auth: { user: "u" } }, plan: "pro" },
    }, {
      accessToken: "new-access", refreshToken: null,
      providerSpecificData: { proxy: { auth: { password: "p" } } },
    });
    expect(merged).toMatchObject({ accessToken: "new-access", refreshToken: "old-refresh", idToken: "old-id" });
    expect(merged.providerSpecificData).toEqual({ proxy: { host: "old", auth: { user: "u", password: "p" } }, plan: "pro" });
    expect(mergeProviderSpecificData({}, JSON.parse('{"__proto__":{"polluted":true}}'))).toEqual({});
    expect({}.polluted).toBeUndefined();
  });
});
