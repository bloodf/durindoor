// GET /api/settings/database
//
// Returns the current database engine, the cluster's
// server_version_num (when reachable), the effective per-feature
// state from the capability gate, and the redacted connection info
// (host, port, database, user, sslmode, authSource). The password is
// never returned.
//
// All routes under /api/settings/database/* sit behind the same
// dual-factor auth (`requireDatabaseDualAuth`) that the existing
// /api/settings/database/export|import routes use. Operators that flip
// the engine or run a cutover already need the dashboard password,
// so the dual-factor contract is the same here.

import { NextResponse } from "next/server";
import { getSettings, getSettingsSync, updateSettings } from "@/lib/db/repos/settingsRepo";
import { requireDatabaseDualAuth } from "../route";
import { evaluateCapabilities, listOperatorDisabled } from "@/lib/db/postgresCapabilityGate";
import { getActiveEngine } from "@/lib/db/driver";
import { listSnapshots } from "@/lib/db/dialects/postgres/snapshot";

export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!(await requireDatabaseDualAuth(request, request.headers.get("x-9r-password")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let settings;
  try {
    settings = await getSettings();
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to read settings" }, { status: 500 });
  }
  const activeEngine = getActiveEngine();
  const cap = evaluateCapabilities(
    {
      serverVersionNum: settings.databasePgVersion
        ? String(settings.databasePgVersion * 10000)
        : "0",
    },
    settings.databasePgVersion,
    settings.databasePgFeatures,
  );
  return NextResponse.json({
    activeEngine,
    databaseEngine: settings.databaseEngine,
    databaseEngineError: settings.databaseEngineError,
    databaseCutoverAt: settings.databaseCutoverAt,
    databaseCutoverSchemaVersion: settings.databaseCutoverSchemaVersion,
    databasePgVersion: settings.databasePgVersion,
    databasePgFeatures: settings.databasePgFeatures,
    effectiveCapabilities: cap.effective,
    versionMismatch: cap.versionMismatch,
    operatorDisabled: listOperatorDisabled(
      { serverVersionNum: String((settings.databasePgVersion || 18) * 10000) },
      settings.databasePgVersion,
      settings.databasePgFeatures,
    ),
    postgresHost: settings.postgresHost,
    postgresPort: settings.postgresPort,
    postgresDatabase: settings.postgresDatabase,
    postgresUser: settings.postgresUser,
    postgresSslmode: settings.postgresSslmode,
    postgresAuthSource: settings.postgresAuthSource,
    snapshots: listSnapshots(),
  });
}

export async function POST(request) {
  if (!(await requireDatabaseDualAuth(request, request.headers.get("x-9r-password")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const next = await updateSettings({
      databasePgVersion: body.databasePgVersion,
      databasePgFeatures: body.databasePgFeatures,
      postgresHost: body.postgresHost,
      postgresPort: body.postgresPort,
      postgresDatabase: body.postgresDatabase,
      postgresUser: body.postgresUser,
      postgresSslmode: body.postgresSslmode,
      postgresAuthSource: body.postgresAuthSource,
    });
    return NextResponse.json({ ok: true, settings: next });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to update settings" }, { status: 500 });
  }
}
