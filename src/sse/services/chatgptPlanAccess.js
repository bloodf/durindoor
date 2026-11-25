import { createHash } from "node:crypto";
import { isString } from "../../shared/utils/typeChecks.js";

function nonempty(value) {
  return isString(value) && value.trim().length > 0;
}

function includesConnection(ids, id) {
  return Array.isArray(ids) && ids.includes(id);
}

/**
 * Build the private transport grant from server-owned inputs only.
 * verifiedKey is already authenticated and carries its explicit providerConnectionIds.
 * allowedConnectionIds is the server's independent allowlist. Both must contain
 * the selected normal OAuth connection's ID. accountSelection comes from trusted
 * configuration for that connection. providerRegistered means the owner has
 * registered this provider in the private runtime.
 *
 * Returns null for denied access. The injected accounts.readAccount service
 * may reject the lookup, in which case its error propagates without a grant.
 */
export async function resolveChatgptPlanAccess({
  verifiedKey,
  allowedConnectionIds,
  selectedConnection,
  accountSelection,
  ownerOperatedEnabled,
  providerRegistered,
  accounts,
  renewExpired,
  clock = Date.now,
} = {}) {
  const connectionId = selectedConnection?.id;
  if (ownerOperatedEnabled !== true || providerRegistered !== true ||
      !nonempty(verifiedKey?.id) || verifiedKey.isActive !== true ||
      !nonempty(connectionId) || selectedConnection.isActive !== true ||
      selectedConnection.provider !== "chatgpt-plan" || selectedConnection.authType !== "oauth" ||
      !includesConnection(verifiedKey.providerConnectionIds, connectionId) ||
      !includesConnection(allowedConnectionIds, connectionId)) {
    return null;
  }

  if (!accountSelection) return null;
  const { id: accountId, issuer, subject, clientId } = accountSelection;
  // Mirror the private account service's selection format before reading credentials.
  if (issuer !== "https://auth.openai.com" || !nonempty(subject) ||
      !isString(clientId) || !/^oaiapp_[A-Za-z0-9_-]{1,256}$/.test(clientId) ||
      accountId !== createHash("sha256").update(clientId).digest("hex")) {
    return null;
  }

  const selection = { id: accountId, issuer, subject, clientId };
  const matchesSession = (record) => record?.id === accountId && record.issuer === issuer &&
    record.subject === subject && record.clientId === clientId && record.planEnabled === true &&
    nonempty(record.accessToken) && record.operation == null && Number.isSafeInteger(record.expiresAt);

  let record = await accounts.readAccount(selection);
  if (!matchesSession(record)) return null;
  if (record.expiresAt <= clock()) {
    // The owner service chooses whether the verified, scoped account can renew.
    // Never issue a grant until its replacement session passes every check.
    if (!renewExpired || !await renewExpired()) return null;
    record = await accounts.readAccount(selection);
    if (!matchesSession(record) || record.expiresAt <= clock()) return null;
  }

  return {
    connection: { id: connectionId, accountId, credentialClass: "chatgpt-plan-oauth", accessToken: record.accessToken },
    grant: { allowed: true, connectionId, accountId },
  };
}
