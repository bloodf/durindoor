import { describe, it, expect } from "vitest";
import { resolveCodexAccountId } from "../../open-sse/shared/codexAccountId.js";

function idTokenFor(accountId) {
  const payload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("#1819 — codex account-id resolution with id_token fallback", () => {
  it("prefers workspaceId over other provider fields", () => {
    expect(resolveCodexAccountId({ workspaceId: "ws", chatgptAccountId: "cg", accountId: "ac" })).toBe("ws");
  });

  it("falls back through chatgptAccountId then accountId", () => {
    expect(resolveCodexAccountId({ chatgptAccountId: "cg", accountId: "ac" })).toBe("cg");
    expect(resolveCodexAccountId({ accountId: "ac" })).toBe("ac");
  });

  it("decodes the account id from the OAuth id_token when provider data has none", () => {
    expect(resolveCodexAccountId({}, idTokenFor("legacy_ws"))).toBe("legacy_ws");
  });

  it("skips blank provider fields before using the id_token", () => {
    expect(resolveCodexAccountId({ workspaceId: "  " }, idTokenFor("legacy_ws"))).toBe("legacy_ws");
  });

  it("returns empty string when nothing resolves", () => {
    expect(resolveCodexAccountId({}, null)).toBe("");
    expect(resolveCodexAccountId({}, "not.a.jwt")).toBe("");
  });

  it("does not decode an id_token when a provider field is present", () => {
    expect(resolveCodexAccountId({ accountId: "ac" }, idTokenFor("legacy_ws"))).toBe("ac");
  });
});
