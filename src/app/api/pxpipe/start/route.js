import { NextResponse } from "next/server";
import { getInstallInfo } from "@/lib/pxpipe/install.js";
import { loadPxpipe } from "@/lib/pxpipe/loader.js";
import { getPxpipeStatus } from "@/lib/pxpipe/service.js";

export const dynamic = "force-dynamic";

// "Start" in library mode = warm the in-process transform module.
// The package is a direct dependency; if missing, surface dependency-missing
// state rather than attempting a runtime npm install.
export async function POST() {
  try {
    const info = getInstallInfo();
    if (!info.installed) {
      return NextResponse.json({ error: info.reason || "PXPIPE dependency is not installed", code: info.code || null }, { status: 409 });
    }
    await loadPxpipe();
    return NextResponse.json(getPxpipeStatus());
  } catch (error) {
    return NextResponse.json({ error: error.message, code: error.code || null, surface: error.surface || null }, { status: 500 });
  }
}
