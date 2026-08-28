import { NextResponse } from "next/server";
import { createProviderConnection, getProviderConnections } from "@/models";
import { decodeXaiIdTokenEmail, extractEmailFromAccessToken } from "@/lib/oauth/providerHelpers";
import { isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";

function normalizeAccounts(body) {
  if (Array.isArray(body)) return body;
  if (body && isObject(body) && Array.isArray(body.accounts)) return body.accounts;
  if (body && isObject(body)) return [body];
  return null;
}

function credential(raw, snakeKey, camelKey) {
  return raw[snakeKey] ?? raw[camelKey];
}

function safeError(error, tokens) {
  let message = error?.message || "Unknown error";
  for (const token of tokens) {
    if (isString(token) && token) message = message.replaceAll(token, "[REDACTED]");
  }
  return message;
}

/**
 * Canonical provider/email key used to detect the bare-email upsert identity.
 * @returns {string|null} Normalized identity, or null when email is unavailable.
 */
function providerEmailIdentity(provider, email) {
  if (!isString(email) || !email.trim()) return null;
  return `${provider}:${email.trim().toLowerCase()}`;
}

/**
 * Bulk-import Grok CLI device-code credentials without changing Grok's OAuth flow.
 * Items run serially because connection priority assignment reads the current maximum.
 * Tokens are accepted as snake_case or camelCase and never echoed in results.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: `Invalid JSON body: ${error.message}` }, { status: 400 });
  }

  const accounts = normalizeAccounts(body);
  if (!accounts?.length) {
    return NextResponse.json({ error: "No accounts provided" }, { status: 400 });
  }

  const results = [];
  let success = 0;
  let failed = 0;
  const existingConnections = await getProviderConnections({ provider: "grok-cli" });
  const knownIdentities = new Set(existingConnections
    .filter((connection) => connection.authType === "oauth")
    .map((connection) => providerEmailIdentity(connection.provider, connection.email))
    .filter(Boolean));

  for (let index = 0; index < accounts.length; index += 1) {
    const raw = accounts[index];
    const tokens = raw && isObject(raw) ? [
      credential(raw, "access_token", "accessToken"),
      credential(raw, "refresh_token", "refreshToken"),
      credential(raw, "id_token", "idToken"),
    ] : [];

    try {
      if (!raw || !isObject(raw) || Array.isArray(raw)) throw new Error("Item is not an object");

      const accessToken = tokens[0];
      const refreshToken = tokens[1] ?? null;
      const idToken = tokens[2] ?? null;
      if (!isString(accessToken) || !accessToken) {
        throw new Error("Missing access_token / accessToken");
      }

      const expiresAtValue = credential(raw, "expires_at", "expiresAt");
      const expiresIn = credential(raw, "expires_in", "expiresIn");
      if (expiresIn !== undefined && expiresIn !== null && (!isNumber(expiresIn) || expiresIn <= 0)) {
        throw new Error("expires_in / expiresIn must be a positive number");
      }
      const expiresAt = expiresAtValue ?? (
        expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
      );

      const email = raw.email ||
        decodeXaiIdTokenEmail(idToken) ||
        extractEmailFromAccessToken(accessToken) ||
        null;
      const identity = providerEmailIdentity("grok-cli", email);
      if (identity && knownIdentities.has(identity)) {
        throw new Error("Duplicate Grok CLI account");
      }
      const providerSpecificData = {
        authMethod: "device_code",
        ...(raw.providerSpecificData?.userId ? { userId: raw.providerSpecificData.userId } : null),
        ...(email ? { email } : null),
      };

      const created = await createProviderConnection({
        provider: "grok-cli",
        authType: "oauth",
        accessToken,
        refreshToken,
        idToken,
        expiresAt,
        email,
        displayName: raw.displayName || raw.name || undefined,
        providerSpecificData,
        testStatus: "active",
        isActive: true,
        lastRefreshAt: raw.lastRefreshAt || new Date().toISOString(),
      });

      results.push({ index, ok: true, id: created.id });
      success += 1;
      if (identity) knownIdentities.add(identity);
    } catch (error) {
      results.push({ index, ok: false, error: safeError(error, tokens) });
      failed += 1;
    }
  }

  return NextResponse.json({ success, failed, results });
}
