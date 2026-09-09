// POST /api/settings/database/cutover
//
// Runs the SQLite → PostgreSQL cutover pipeline. Body: `{ url, sslmode,
// includeRequestDetails }`. Returns the result object from `runCutover`
// (200 on success, 400/500 on failure, 503 when the CutoverLock is
// already held).

import { NextResponse } from "next/server";
import { requireDatabaseDualAuth } from "../route";
import { runCutover, isCutoverInFlight } from "@/lib/db/cutover";
import { resolvePostgresSecret } from "@/lib/db/secrets";
import { isObject, isString, isBoolean } from "../../../../../shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

/**
 * Read and parse the request body. An empty body is allowed; the
 * resolver falls back to the stored secret. Validation here is the
 * I/O boundary: downstream code can rely on the field types.
 */
async function readCutoverBody(request) {
  let body = {};
  try { body = await request.json(); } catch { /* empty body is OK */ }
  if (!isObject(body)) return { url: null, sslmode: undefined, includeRequestDetails: false };
  return {
    url: isString(body.url) && body.url ? body.url : null,
    sslmode: isString(body.sslmode) ? body.sslmode : undefined,
    includeRequestDetails: isBoolean(body.includeRequestDetails) ? body.includeRequestDetails : false,
  };
}

export async function POST(request) {
  if (!(await requireDatabaseDualAuth(request, request.headers.get("x-9r-password")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isCutoverInFlight()) {
    return NextResponse.json(
      { error: "A cutover is already in flight; retry in a moment." },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }
  const parsed = await readCutoverBody(request);
  // The body URL wins; otherwise we resolve from the settings row
  // (which is the canonical storage for the encrypted URL).
  const url = parsed.url || (await resolvePostgresSecret());
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "url is required (provide it in the body or save it via /test)" },
      { status: 400 }
    );
  }
  const out = await runCutover({
    url,
    sslmode: parsed.sslmode,
    includeRequestDetails: parsed.includeRequestDetails,
  });
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}
