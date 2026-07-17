import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { getPxpipeStatus } from "@/lib/pxpipe/service.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    const status = getPxpipeStatus();
    return NextResponse.json({
      ...status,
      enabled: !!settings.pxpipeEnabled,
      // pxpipeAutoInstall is retained in settings for compatibility with old
      // TokenSaverClient callers, but it no longer triggers runtime installs.
      autoInstall: !!settings.pxpipeAutoInstall,
      minChars: settings.pxpipeMinChars,
      timeoutMs: settings.pxpipeTimeoutMs,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
