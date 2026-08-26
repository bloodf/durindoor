import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { hasValidCliToken, hasValidToken } from "@/dashboardGuard";
import { DATABASE_IMPORT_MAX_BYTES } from "@/shared/constants/quota";

const PASSWORD_HEADER = "x-9r-password";

const DUAL_AUTH_UNAUTHORIZED = {
  error: "Unauthorized: CLI token + password or JWT session + password required",
};

/**
 * Dual-factor gate for credential-bearing database export/import.
 *
 * `/api/settings/database` is ALWAYS_PROTECTED, so a valid JWT or machine-bound
 * CLI token already reaches this handler. That first factor alone must not dump
 * or replace credentials (GHSA-qvfm): require the dashboard password as the
 * second factor on both paths.
 *
 * Emergency recovery is unchanged: POST `/api/auth/reset-password` remains
 * loopback-only (CLI token or trusted local origin). There is no loopback-only
 * bypass that exports/imports with a stolen CLI token alone.
 *
 * @param {Request} request
 * @param {string|null|undefined} password
 * @returns {Promise<boolean>}
 */
export async function requireDatabaseDualAuth(request, password) {
  const cliOk = await hasValidCliToken(request);
  const jwtOk = await hasValidToken(request);
  if (!cliOk && !jwtOk) return false;
  if (!password || !(await verifyDashboardPassword(password))) return false;
  return true;
}

class DatabaseImportTooLargeError extends Error {
  constructor() {
    super("Database import exceeds the byte safety limit");
    this.name = "DatabaseImportTooLargeError";
    this.code = "DATABASE_IMPORT_TOO_LARGE";
  }
}

/** Read JSON incrementally so chunked requests cannot bypass Content-Length. */
export async function readJsonBodyWithLimit(request, maxBytes = DATABASE_IMPORT_MAX_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Database import byte limit is invalid");
  const contentLength = request.headers.get("content-length");
  if (/^\d+$/.test(contentLength || "") && Number(contentLength) > maxBytes) {
    throw new DatabaseImportTooLargeError();
  }
  if (!request.body) throw new Error("Database import body is required");

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new DatabaseImportTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text);
}

export async function GET(request) {
  try {
    const password = request.headers.get(PASSWORD_HEADER);
    if (!(await requireDatabaseDualAuth(request, password))) {
      return NextResponse.json(DUAL_AUTH_UNAUTHORIZED, { status: 401 });
    }
    // SEC-B-02: credentials are scrubbed from the portable export by default.
    // Operators who need a full backup (e.g. migrating DATA_DIR to a new
    // host) pass ?includeSecrets=true. Encrypted blobs are decrypted back to
    // plaintext in opt-in mode so the backup stays portable across machines.
    const url = new URL(request.url);
    const includeSecrets = url.searchParams.get("includeSecrets") === "true";
    const payload = await exportDb({ includeSecrets });
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { password, ...payload } = await readJsonBodyWithLimit(request);
    if (!(await requireDatabaseDualAuth(request, password))) {
      return NextResponse.json(DUAL_AUTH_UNAUTHORIZED, { status: 401 });
    }
    await importDb(payload);

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    const tooLarge = error?.code === "DATABASE_IMPORT_TOO_LARGE";
    return NextResponse.json(
      { error: tooLarge ? "Database import is too large" : (error?.message || "Failed to import database") },
      { status: tooLarge ? 413 : 400 }
    );
  }
}
