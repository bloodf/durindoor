import { expect, it } from "vitest";
import { codexCredentialBindingMismatch } from "../../open-sse/services/usage/codexCredentialBinding.js";
import { getCodexUsage } from "../../open-sse/services/usage/codex.js";

const jwt = (user, account) => `e30.${Buffer.from(JSON.stringify({ sub: user, "https://api.openai.com/auth": { chatgpt_user_id: user, chatgpt_account_id: account } })).toString("base64url")}.sig`;

it("rejects mismatched identity before fetching quota without rejecting team workspaces or opaque tokens", async () => {
  const token = jwt("user-a", "account-a");
  const personal = { workspaceStructure: "personal", workspaceId: "account-b" };
  expect(codexCredentialBindingMismatch(token, personal)).toBe("personal_account_mismatch");
  expect((await getCodexUsage(token, personal)).message).toMatch(/identity does not match/);
  expect(codexCredentialBindingMismatch(token, {}, jwt("user-b", "account-a"))).toBe("user_mismatch");
  expect(codexCredentialBindingMismatch(token, { workspaceStructure: "team", workspaceId: "account-b" })).toBeNull();
  expect(codexCredentialBindingMismatch("opaque", personal)).toBeNull();
});
