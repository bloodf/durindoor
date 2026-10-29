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
import { composeDatabaseStartup } from "@/lib/db/databaseEnvFile";
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
  if (!body || !isObject(body) || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  let url = body.url;
  if (!Object.hasOwn(body, "url")) {
    try {
      const values = composeDatabaseStartup({ ...body, engine: "postgres" });
      const candidate = new URL(values.DURINDOOR_PG_URL);
      candidate.searchParams.set("sslmode", values.DURINDOOR_PG_SSLMODE);
      url = candidate.toString();
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
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
  let out;
  try {
    out = await testConnection({ url: parsed.url, sslmode: parsed.sslmode });
  } catch {
    return NextResponse.json({ ok: false, error: "PostgreSQL connection probe failed" }, { status: 400 });
  }
  if (!out.ok) {
    return NextResponse.json({ ok: false, error: "PostgreSQL connection probe failed. Check connection values and cluster availability.", latencyMs: out.latencyMs }, { status: 400 });
  }
  if (parsed.persist) {
    try {
      // Persist the URL to the settings row (encrypted) so the
      // operator does not need an env var. The cutover pipeline and
      // the boot-time fallback both read from the settings row via
      // `resolvePostgresSecret()`.
      await writePostgresUrlToSettings(parsed.url);
    } catch {
      return NextResponse.json({ ok: false, error: "Failed to persist PostgreSQL target" }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, latencyMs: out.latencyMs, serverVersion: out.serverVersion });
}
