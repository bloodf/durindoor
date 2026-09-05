// Selective provider/combo transfer. Every action uses dual auth; preview is secret-free.
import { NextResponse } from "next/server";
import { exportSelectiveDb, getSelectiveTransferCatalog, importSelectiveDb, previewSelectiveImport } from "@/lib/localDb";
import { DATABASE_IMPORT_MAX_BYTES, readJsonBodyWithLimit, requireDatabaseDualAuth } from "../route.js";
import { isBoolean, isObject, isString } from "@/shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";
const UNAUTHORIZED = { error: "Unauthorized: CLI token + password or JWT session + password required" };

function badResponse(error, status = 400) { return NextResponse.json({ error }, { status }); }
function normalizeSelection(value) {
  if (!value || !isObject(value) || Array.isArray(value)) throw new Error("Transfer selection must be an object");
  const ids = (key) => {
    const rows = value[key] ?? [];
    if (!Array.isArray(rows) || rows.some((id) => !isString(id) || !id.trim()) || new Set(rows).size !== rows.length) throw new Error(`Transfer ${key} must be unique non-empty IDs`);
    return rows;
  };
  return { providers: ids("providers"), combos: ids("combos") };
}

/** Database-touching actions require JWT/CLI plus dashboard password. Preview always excludes credentials; acknowledged exports may include only the DB's encrypted-at-rest top-level credential fields. */
export async function POST(request) {
  let hasQueryAction = false;
  try { hasQueryAction = new URL(request.url).searchParams.has("action"); } catch { return badResponse("Invalid request URL"); }
  let body;
  try { body = await readJsonBodyWithLimit(request, DATABASE_IMPORT_MAX_BYTES); }
  catch (error) { return badResponse(error?.code === "DATABASE_IMPORT_TOO_LARGE" ? "Selective transfer request is too large" : (error?.message || "Invalid selective transfer body"), error?.code === "DATABASE_IMPORT_TOO_LARGE" ? 413 : 400); }
  const { password, action, selection: requestedSelection, bundle, includeSecrets = false, acknowledgeSecretExport = false } = body || {};
  if (!(await requireDatabaseDualAuth(request, password))) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  if (hasQueryAction) return badResponse("Selective transfer action must be passed in the JSON body, not the query string");
  try {
    if (action === "catalog") return NextResponse.json(await getSelectiveTransferCatalog());
    if (action === "preview") {
      const projection = bundle && isObject(bundle) ? await previewSelectiveImport(bundle, requestedSelection) : await exportSelectiveDb(normalizeSelection(requestedSelection), { includeSecrets: false });
      return NextResponse.json({ ...projection, secretsIncluded: false });
    }
    if (action === "export") {
      if (!isBoolean(includeSecrets) || !isBoolean(acknowledgeSecretExport)) return badResponse("Secret export flags must be booleans");
      if (includeSecrets && !acknowledgeSecretExport) return badResponse("Exporting credentials requires acknowledgeSecretExport: true");
      return NextResponse.json({ ...(await exportSelectiveDb(normalizeSelection(requestedSelection), { includeSecrets })), secretsIncluded: includeSecrets });
    }
    if (action === "apply") return NextResponse.json({ success: true, ...(await importSelectiveDb(bundle, requestedSelection == null ? undefined : normalizeSelection(requestedSelection))) });
    return badResponse(`Unknown selective transfer action: ${action || "(missing)"}`);
  } catch (error) { return badResponse(error?.message || "Selective transfer failed"); }
}
