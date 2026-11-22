/**
 * Route handlers for provider cookie import (contract: ./README.md).
 *
 *  - `handleCookieImportPairing`: dashboard operator mints a one-use pairing.
 *  - `handleCookieImport`: the extension presents it with the browser cookies.
 *
 * The import handler is authenticated only by the pairing secret. It never
 * consults dashboard sessions, CLI tokens or application API keys, so it is
 * not a credential for anything else, and the pairing secret is not accepted by
 * any other route.
 */

import { NextRequest } from "next/server";
import { canAccessManagementApi, isOperatorRequest, hasExactRequestOrigin } from "@/dashboardGuard";
import { getProviderConnectionById, updateProviderConnection } from "@/models";
import { createProvider } from "@/lib/providerRouteHandlers";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { isIsolatedLoginRequest, ownerBinding } from "@/lib/webLoginSession";
import { isString, isRecord } from "@/shared/utils/typeChecks";
import { getCookieImportContract, describeCookieImportContract, buildImportedCookieHeader, validateImportedLocalStorage } from "./contract";
import { issuePairing, consumePairing, isWellFormedPairingToken, PAIRING_TTL_MS } from "./pairing";

export const PAIRING_HEADER = "x-durindoor-pairing-token";
export const MAX_IMPORT_BODY_BYTES = 32 * 1024;
export const MAX_PAIRING_BODY_BYTES = 4 * 1024;
const MAX_NAME_LENGTH = 120;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Origin the client actually reached. Scheme comes from the transport unless the Host is the operator-configured
 * public address (a TLS terminator makes the socket plain HTTP). `requestOrigin` is not used: it falls back to the
 * configured dashboard origin for any other Host, which would let a plain-HTTP call pass as HTTPS.
 */
function reachedOrigin(request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  for (const raw of [process.env.BASE_URL, process.env.NEXT_PUBLIC_BASE_URL]) {
    try {
      const configured = new URL(raw);
      if (configured.host === host) return configured;
    } catch { /* An absent or malformed configured origin is not trusted. */ }
  }
  return new URL(`${url.protocol}//${host}`);
}

/** Cookie values and pairing secrets cross this hop only over HTTPS, or plain HTTP to a loopback host for local development. */
function hasAcceptableTransport(request) {
  try {
    const origin = reachedOrigin(request);
    if (origin.protocol === "https:") return true;
    return origin.protocol === "http:" && LOOPBACK_HOSTS.has(origin.hostname.toLowerCase().replace(/^\[|\]$/g, ""));
  } catch {
    return false;
  }
}

/** Read and parse a JSON object, refusing more than `limit` bytes without buffering the excess. */
async function readJsonObject(request, limit) {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) return { status: 415, error: "Content-Type must be application/json" };
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return { status: 413, error: "Request body too large" };
  const reader = request.body?.getReader();
  if (!reader) return { status: 400, error: "Invalid JSON" };
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return { status: 413, error: "Request body too large" };
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!isRecord(body)) return { status: 400, error: "Invalid JSON" };
    return { body };
  } catch {
    return { status: 400, error: "Invalid JSON" };
  }
}

/** POST /api/providers/cookie-import/pairing — operator-only. */
export async function handleCookieImportPairing(request) {
  if (isIsolatedLoginRequest(request)) return json({ error: "Dashboard origin required" }, 403);
  if (!(await canAccessManagementApi(request)) || !(await isOperatorRequest(request))) return json({ error: "Operator access required" }, 403);
  if (request.headers.get("origin") && !hasExactRequestOrigin(request)) return json({ error: "Cross-origin request denied" }, 403);
  if (!hasAcceptableTransport(request)) return json({ error: "HTTPS is required" }, 403);
  const read = await readJsonObject(request, MAX_PAIRING_BODY_BYTES);
  if (read.error) return json({ error: read.error }, read.status);
  const { body } = read;

  const provider = normalizeProviderId(body.provider);
  const contract = isString(provider) ? getCookieImportContract(provider) : null;
  if (!contract) return json({ error: "Provider does not support cookie import" }, 400);

  let target;
  if (body.action === "create") {
    const name = isString(body.name) ? body.name.trim() : "";
    if (!name || name.length > MAX_NAME_LENGTH || body.connectionId !== undefined) return json({ error: "A create pairing needs a name and no connectionId" }, 400);
    target = { action: "create", name };
  } else if (body.action === "update") {
    if (!isString(body.connectionId) || !body.connectionId || body.name !== undefined) return json({ error: "An update pairing needs a connectionId and no name" }, 400);
    const existing = await getProviderConnectionById(body.connectionId);
    if (!existing) return json({ error: "Connection not found" }, 404);
    if (existing.provider !== provider || existing.authType !== contract.authType) return json({ error: "Connection does not belong to this provider" }, 409);
    target = { action: "update", connectionId: existing.id };
  } else {
    return json({ error: "action must be create or update" }, 400);
  }

  const pairing = issuePairing({ provider, owner: ownerBinding(request), target });
  if (!pairing) return json({ error: "Too many pending pairings" }, 429);
  return json({
    pairing: {
      token: pairing.token,
      expiresAt: new Date(pairing.expiresAt).toISOString(),
      ttlSeconds: PAIRING_TTL_MS / 1000,
      header: PAIRING_HEADER,
      provider,
      ...target,
      importUrl: `${reachedOrigin(request).origin}/api/providers/cookie-import`,
      contract: { ...describeCookieImportContract(contract), ...(contract.optionalCookies?.length ? { optionalCookies: [...contract.optionalCookies] } : null) },
    },
  }, 201);
}

/** POST /api/providers/cookie-import — authenticated by the pairing secret alone. */
export async function handleCookieImport(request) {
  if (isIsolatedLoginRequest(request)) return json({ error: "Dashboard origin required" }, 403);
  if (!hasAcceptableTransport(request)) return json({ error: "HTTPS is required" }, 403);
  const token = request.headers.get(PAIRING_HEADER);
  if (!isWellFormedPairingToken(token)) return json({ error: "Invalid or expired pairing" }, 401);
  const read = await readJsonObject(request, MAX_IMPORT_BODY_BYTES);
  if (read.error) return json({ error: read.error }, read.status);
  const { body } = read;

  // Taken before any comparison: whatever happens next, this secret is spent.
  const pairing = consumePairing(token);
  if (!pairing) return json({ error: "Invalid or expired pairing" }, 401);

  const { target } = pairing;
  const matches = normalizeProviderId(body.provider) === pairing.provider &&
    (target.action === "update" ? body.connectionId === target.connectionId : body.connectionId === undefined) &&
    (target.action === "create" && body.name !== undefined ? body.name === target.name : true);
  if (!matches) return json({ error: "Pairing does not match this request" }, 409);

  const contract = getCookieImportContract(pairing.provider);
  if (!contract) return json({ error: "Provider does not support cookie import" }, 400);
  if (body.origin !== contract.origin) return json({ error: "Origin is not approved for this provider" }, 400);
  const built = buildImportedCookieHeader(contract, body.cookies);
  if (!built.ok) return json({ error: built.error }, 400);
  // Named localStorage values (TinyCMS `app-config-uuid`) travel beside the cookies and are
  // stored in providerSpecificData under their own key, never in the cookie header.
  const stored = validateImportedLocalStorage(contract, body.localStorage);
  if (!stored.ok) return json({ error: stored.error }, 400);
  const hasStoredValues = Object.keys(stored.values).length > 0;

  try {
    if (target.action === "create") {
      const response = await createProvider(new NextRequest(new URL("/api/providers", request.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: pairing.provider,
          name: target.name,
          ...(built.header ? { apiKey: built.header } : null),
          ...(hasStoredValues ? { providerSpecificData: stored.values } : null),
        }),
      }), { requireNewCookieName: true });
      if (response.status === 409) return json({ error: "A connection with this name already exists" }, 409);
      if (!response.ok) return json({ error: "Could not save the connection" }, 500);
      const { connection } = await response.json();
      return json({ ok: true, action: "create", connection: { id: connection.id, provider: connection.provider, name: connection.name } }, 201);
    }
    const existing = await getProviderConnectionById(target.connectionId);
    if (!existing) return json({ error: "Connection not found" }, 404);
    if (existing.provider !== pairing.provider || existing.authType !== contract.authType) return json({ error: "Connection does not belong to this provider" }, 409);
    // `provider` makes the repository refuse the write inside its transaction if the row changed identity.
    // An explicit active status is what clears a pending reauthentication marker on credential replacement.
    // A localStorage-only import replaces the stored value and clears a pasted key, which would otherwise win.
    const update = { provider: pairing.provider, testStatus: "active" };
    if (contract.cookieNames.length) update.apiKey = built.header;
    else update.apiKey = null;
    if (hasStoredValues) update.providerSpecificData = { ...(existing.providerSpecificData || {}), ...stored.values };
    const updated = await updateProviderConnection(target.connectionId, update);
    if (!updated) return json({ error: "Connection not found" }, 404);
    return json({ ok: true, action: "update", connection: { id: updated.id, provider: updated.provider, name: updated.name } });
  } catch (error) {
    // Only the error code is logged: messages and bodies could carry request data.
    console.error("Cookie import failed", error?.code || "unknown");
    if (error?.code === "PROVIDER_IDENTITY_IMMUTABLE") return json({ error: "Connection does not belong to this provider" }, 409);
    return json({ error: "Could not save the connection" }, 500);
  }
}
