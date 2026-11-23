import { isObject } from "./typeChecks.js";
const PROVIDER_REFRESH_CONTEXT_FIELDS = Object.freeze([
"accountId",
"authKind",
"authMethod",
"baseUrl",
"clientId",
"client_id",
"clientSecret",
"codexSelectedWorkspaceId",
"chatgptAccountId",
"chatgptWorkspaceId",
"copilotToken",
"profileArn",
"provider",
"region",
"resourceUrl",
"scope",
"scopes",
"tokenEndpoint",
"token_endpoint",
"workspaceId"]
);

function providerData(connection) {
  const value = connection?.providerSpecificData;
  return value && isObject(value) && !Array.isArray(value) ? value : {};
}

function cloneContextValue(value) {
  if (value === null || value === undefined) return null;
  return isObject(value) ? structuredClone(value) : value;
}

/**
 * Capture the sending session for cookie rotation or the credentials and
 * provider metadata that bind an OAuth refresh. Unrelated connection metadata
 * is omitted so concurrent display and policy edits can merge safely.
 */
export function providerRefreshContext(connection) {
  const data = providerData(connection);
  if (connection?.authType === "cookie") {
    return {
      id: connection.id ?? null,
      provider: connection.provider ?? null,
      authType: connection.authType,
      apiKey: connection.apiKey ?? null,
      storageState: cloneContextValue(data.storageState)
    };
  }
  return {
    provider: connection?.provider ?? null,
    authType: connection?.authType ?? null,
    accessToken: connection?.accessToken ?? null,
    refreshToken: connection?.refreshToken ?? null,
    idToken: connection?.idToken ?? null,
    providerSpecificData: Object.fromEntries(
      PROVIDER_REFRESH_CONTEXT_FIELDS.map((field) => [field, cloneContextValue(data[field])])
    )
  };
}

export function providerCredentialBytes(connection) {
  return {
    accessToken: connection?.accessToken ?? null,
    refreshToken: connection?.refreshToken ?? null,
    idToken: connection?.idToken ?? null,
    copilotToken: providerData(connection).copilotToken ?? null
  };
}

export function providerCredentialBytesMatch(left, right) {
  return JSON.stringify(providerCredentialBytes(left)) === JSON.stringify(providerCredentialBytes(right));
}

export function providerRefreshContextMatches(connection, expected) {
  if (!expected || !isObject(expected) || Array.isArray(expected)) return true;
  return JSON.stringify(providerRefreshContext(connection)) === JSON.stringify(expected);
}
