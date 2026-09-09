// POST /api/settings/database/test
//
// Probes a candidate PG connection URL without opening the persistent
// adapter. Used by the dashboard "Test connection" button. Returns
// `{ ok, latencyMs, serverVersion }` on success or `{ ok: false,
// error, latencyMs }` on failure. The password is never logged.

import { NextResponse } from "next/server";
import { requireDatabaseDualAuth } from "../route";
import { testConnection } from "@/lib/db/cutover";
import { writePostgresUrlToSettings } from "@/lib/db/secrets";
import { isObject, isString, isBoolean } from "../../../../../shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

/**
 * Read and parse the request body, returning a validated shape. The
 * validation here is the I/O boundary: every downstream consumer of
 * `parsed` can rely on the field types without re-checking.
 */
async function readTestBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }
  if (!isObject(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const url = body.url;
  if (!isString(url) || url.length === 0) {
    return { ok: false, error: "url is required" };
  }
  return {
    ok: true,
    url,
    sslmode: isString(body.sslmode) ? body.sslmode : undefined,
    persist: isBoolean(body.persist) ? body.persist : false,
  };
}

export async function POST(request) {
  if (!(await requireDatabaseDualAuth(request, request.headers.get("x-9r-password")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = await readTestBody(request);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  if (parsed.persist) {
    try {
      // Persist the URL to the settings row (encrypted) so the
      // operator does not need an env var. The cutover pipeline and
      // the boot-time fallback both read from the settings row via
      // `resolvePostgresSecret()`.
      await writePostgresUrlToSettings(parsed.url);
    } catch (err) {
      return NextResponse.json({ ok: false, error: `persist failed: ${err.message}` }, { status: 500 });
    }
  }
  const out = await testConnection({ url: parsed.url, sslmode: parsed.sslmode });
  return NextResponse.json(out, { status: out.ok ? 200 : 400 });
}
