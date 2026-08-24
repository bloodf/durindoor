import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";
import { CODEX_FINGERPRINT_MODES } from "open-sse/config/codexIdentity.js";

/**
 * POST /api/oauth/codex/bulk-import
 * Bulk import multiple codex (OAuth) account JSON objects in one call.
 *
 * Body accepts any of:
 *   - Array:    [{...}, {...}]
 *   - Single:   {...}
 *   - Wrapped:  { accounts: [{...}, ...] }
 *
 * Each item must contain at least `accessToken`. Missing email / chatgpt
 * account info is best-effort backfilled from the JWT (idToken or accessToken).
 *
 * Tokens are NEVER echoed back in the response.
 */import { isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${err.message}` },
      { status: 400 }
    );
  }

  // Normalize to array
  let accounts;
  if (Array.isArray(body)) {
    accounts = body;
  } else if (body && isObject(body) && Array.isArray(body.accounts)) {
    accounts = body.accounts;
  } else if (body && isObject(body)) {
    accounts = [body];
  } else {
    accounts = null;
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json(
      { error: "No accounts provided" },
      { status: 400 }
    );
  }

  const globalCodexFingerprintMode = CODEX_FINGERPRINT_MODES.includes(body?.codexFingerprintMode) ?
  body.codexFingerprintMode :
  null;

  const results = [];
  let success = 0;
  let failed = 0;

  // SERIAL loop — createProviderConnection reads max(priority) and reorders
  // inside a transaction. Parallel calls would race on priority assignment.
  for (let i = 0; i < accounts.length; i++) {
    const raw = accounts[i];
    try {
      if (!raw || !isObject(raw) || Array.isArray(raw)) {
        throw new Error("Item is not an object");
      }

      // Strip server-controlled fields
      const {
        id: _id,
        provider: _provider,
        authType: _authType,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...item
      } = raw;

      if (!item.accessToken || !isString(item.accessToken)) {
        throw new Error("Missing accessToken");
      }

      // Backfill missing identity fields from JWT claims
      const psd = item.providerSpecificData && isObject(item.providerSpecificData) ?
      { ...item.providerSpecificData } :
      {};
      psd.codexFingerprintMode = CODEX_FINGERPRINT_MODES.includes(psd.codexFingerprintMode) ?
      psd.codexFingerprintMode :
      globalCodexFingerprintMode || "session";
      delete psd.codexClientIdentity;
      delete psd.codexOriginalIdentityHeaders;
      const needsEmail = !item.email;
      const needsAccountId = !psd.chatgptAccountId;
      const needsPlanType = !psd.chatgptPlanType;

      if (needsEmail || needsAccountId || needsPlanType) {
        const info = extractCodexAccountInfo(item.idToken || item.accessToken) || {};
        if (needsEmail && info.email) item.email = info.email;
        if (needsAccountId && info.chatgptAccountId) {
          psd.chatgptAccountId = info.chatgptAccountId;
        }
        if (needsPlanType && info.chatgptPlanType) {
          psd.chatgptPlanType = info.chatgptPlanType;
        }
      }
      if (Object.keys(psd).length > 0) {
        item.providerSpecificData = psd;
      }

      // Compute expiresAt from expiresIn if absent
      if (!item.expiresAt && isNumber(item.expiresIn) && item.expiresIn > 0) {
        item.expiresAt = new Date(Date.now() + item.expiresIn * 1000).toISOString();
      }

      // Defaults aligned with OAuth-completed flow
      if (item.testStatus === undefined) item.testStatus = "active";
      if (item.isActive === undefined) item.isActive = true;
      if (!item.lastRefreshAt) item.lastRefreshAt = new Date().toISOString();

      const created = await createProviderConnection({
        provider: "codex",
        authType: "oauth",
        ...item
      });

      results.push({ index: i, ok: true, id: created.id });
      success++;
    } catch (e) {
      results.push({ index: i, ok: false, error: e.message || "Unknown error" });
      failed++;
    }
  }

  return NextResponse.json({ success, failed, results });
}