import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { resolveChatgptPlanAccess } from "../../src/sse/services/chatgptPlanAccess.js";

const now = 1_800_000_000_000;
const clientId = "oaiapp_synthetic";
const selection = {
  id: createHash("sha256").update(clientId).digest("hex"),
  issuer: "https://auth.openai.com",
  subject: "synthetic-subject",
  clientId,
};
const selectedConnection = {
  id: "normal-connection",
  provider: "chatgpt-plan",
  authType: "oauth",
  isActive: true,
  accessToken: "unused-connection-token",
};
const verifiedKey = { id: "key", isActive: true, providerConnectionIds: [selectedConnection.id] };
const privateRecord = {
  ...selection,
  planEnabled: true,
  operation: null,
  expiresAt: now + 1000,
  accessToken: "synthetic-private-token",
};

function fixture(record = privateRecord) {
  const readAccount = vi.fn().mockResolvedValue(record);
  return {
    verifiedKey,
    selectedConnection,
    allowedConnectionIds: [selectedConnection.id],
    accountSelection: selection,
    ownerOperatedEnabled: true,
    providerRegistered: true,
    accounts: { readAccount },
    clock: () => now,
  };
}

describe("resolveChatgptPlanAccess", () => {
  it.each([
    ["missing key", { verifiedKey: null }],
    ["inactive key", { verifiedKey: { ...verifiedKey, isActive: false } }],
    ["missing key scope", { verifiedKey: { ...verifiedKey, providerConnectionIds: undefined } }],
    ["default key scope", { verifiedKey: { ...verifiedKey, providerConnectionIds: null } }],
    ["empty key scope", { verifiedKey: { ...verifiedKey, providerConnectionIds: [] } }],
    ["wrong key scope", { verifiedKey: { ...verifiedKey, providerConnectionIds: ["other"] } }],
    ["missing allowlist", { allowedConnectionIds: undefined }],
    ["empty allowlist", { allowedConnectionIds: [] }],
    ["wrong allowlist", { allowedConnectionIds: ["other"] }],
    ["missing connection", { selectedConnection: null }],
    ["invalid connection ID", { selectedConnection: { ...selectedConnection, id: "" } }],
    ["inactive connection", { selectedConnection: { ...selectedConnection, isActive: false } }],
    ["wrong provider", { selectedConnection: { ...selectedConnection, provider: "codex" } }],
    ["wrong auth type", { selectedConnection: { ...selectedConnection, authType: "apikey" } }],
    ["missing account selection", { accountSelection: null }],
    ["invalid private ID", { accountSelection: { ...selection, id: "invalid" } }],
    ["private ID from a different client", { accountSelection: { ...selection, id: "a".repeat(64) } }],
    ["wrong issuer", { accountSelection: { ...selection, issuer: "https://invalid.example" } }],
    ["empty subject", { accountSelection: { ...selection, subject: " " } }],
    ["invalid client ID", { accountSelection: { ...selection, clientId: "invalid" } }],
    ["owner-operated disabled", { ownerOperatedEnabled: false }],
    ["provider unregistered", { providerRegistered: false }],
    ["policy supplied in HTTP body", { verifiedKey: null, body: { verifiedKey } }],
  ])("denies %s before loading credentials", async (_reason, override) => {
    const input = fixture();
    await expect(resolveChatgptPlanAccess({ ...input, ...override })).resolves.toBeNull();
    expect(input.accounts.readAccount).not.toHaveBeenCalled();
  });

  it.each([
    ["missing account", null],
    ["different ID", { ...privateRecord, id: "different" }],
    ["different issuer", { ...privateRecord, issuer: "different" }],
    ["different subject", { ...privateRecord, subject: "different" }],
    ["different client", { ...privateRecord, clientId: "oaiapp_different" }],
    ["plan disabled", { ...privateRecord, planEnabled: false }],
    ["missing token", { ...privateRecord, accessToken: "" }],
    ["expired session", { ...privateRecord, expiresAt: now }],
    ["missing expiry", { ...privateRecord, expiresAt: null }],
    ["claimed session", { ...privateRecord, operation: "revoke" }],
  ])("denies a loaded record with %s", async (_reason, record) => {
    const input = fixture(record);
    await expect(resolveChatgptPlanAccess(input)).resolves.toBeNull();
    expect(input.accounts.readAccount).toHaveBeenCalledExactlyOnceWith(selection);
  });

  it("binds the selected normal connection to exactly the selected private account", async () => {
    const input = fixture();
    await expect(resolveChatgptPlanAccess(input)).resolves.toStrictEqual({
      connection: {
        id: selectedConnection.id,
        accountId: selection.id,
        credentialClass: "chatgpt-plan-oauth",
        accessToken: privateRecord.accessToken,
      },
      grant: { allowed: true, connectionId: selectedConnection.id, accountId: selection.id },
    });
    expect(input.accounts.readAccount).toHaveBeenCalledExactlyOnceWith(selection);
  });
});
