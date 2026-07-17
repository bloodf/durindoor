import { NextResponse } from "next/server";
import { installPxpipe } from "@/lib/pxpipe/install.js";
import { unloadPxpipe } from "@/lib/pxpipe/loader.js";
import { runHealthCheck } from "@/lib/pxpipe/service.js";

export const dynamic = "force-dynamic";

// Verify the bundled dependency is present, drop any cached module version,
// then run the health check. The package is a direct dependency, so this
// endpoint no longer performs a network install.
export async function POST() {
  try {
    const info = await installPxpipe();
    unloadPxpipe(); // drop any previously-loaded version so health loads the fresh one
    const health = await runHealthCheck();
    return NextResponse.json({ ...info, health });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: error.code || null, surface: error.surface || null }, { status: 500 });
  }
}
