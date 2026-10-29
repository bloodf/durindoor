import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireDatabaseDualAuth } from "../route";
import { testConnection } from "@/lib/db/cutover";
import { databaseEnvFilePath, composeDatabaseStartup, writeDatabaseEnvFile, describeDatabaseStartup } from "@/lib/db/databaseEnvFile";
import { getActiveEngine } from "@/lib/db/driver";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!(await requireDatabaseDualAuth(request, request.headers.get("x-9r-password")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let values;
  try {
    values = composeDatabaseStartup(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? "Invalid JSON body" : error.message }, { status: 400 });
  }
  if (values.DURINDOOR_DATABASE_ENGINE === "postgres") {
    let probe;
    try {
      probe = await testConnection({ url: values.DURINDOOR_PG_URL, sslmode: values.DURINDOOR_PG_SSLMODE });
    } catch {
      return NextResponse.json({ error: "PostgreSQL connection probe failed" }, { status: 400 });
    }
    if (!probe.ok) {
      // Driver errors may contain the full connection string or password.
      return NextResponse.json({ error: "PostgreSQL connection probe failed. Check connection values and cluster availability." }, { status: 400 });
    }
    if (new URL(request.url).searchParams.get("test") === "1") {
      return NextResponse.json({ ok: true, latencyMs: probe.latencyMs, serverVersion: probe.serverVersion });
    }
  }
  if (new URL(request.url).searchParams.get("test") === "1") {
    return NextResponse.json({ error: "Connection testing requires PostgreSQL" }, { status: 400 });
  }
  try {
    writeDatabaseEnvFile(values);
    return NextResponse.json({ ok: true, restartRequired: true, startupEnv: describeDatabaseStartup(undefined, getActiveEngine()) });
  } catch {
    return NextResponse.json({ error: "Failed to write managed database configuration" }, { status: 500 });
  }
}

export async function DELETE(request) {
  if (!(await requireDatabaseDualAuth(request, request.headers.get("x-9r-password")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    fs.rmSync(databaseEnvFilePath(), { force: true });
    return NextResponse.json({ ok: true, restartRequired: true, startupEnv: describeDatabaseStartup(undefined, getActiveEngine()) });
  } catch {
    return NextResponse.json({ error: "Failed to remove managed database configuration" }, { status: 500 });
  }
}
