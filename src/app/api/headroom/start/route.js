import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { startHeadroomProxy, getHeadroomLogTail } from "@/lib/headroom/process";
import { DEFAULT_HEADROOM_URL, isLoopbackHeadroomUrl } from "@/lib/headroom/detect";
import { SetupError, createDiagnostic, isUserFixable, toDiagnosticResponse } from "@/shared/utils/setupDiagnostics";

export const dynamic = "force-dynamic";

function parsePortFromUrl(url) {
  try {
    const u = new URL(url);
    const p = parseInt(u.port, 10);
    if (p > 0 && p < 65536) return p;
  } catch { /* ignore, fall through to default */ }
  return null;
}

function respondWithError(error) {
  if (error instanceof SetupError) {
    const status = isUserFixable(error.code) ? 400 : 500;
    return NextResponse.json(toDiagnosticResponse(error.diagnostic), { status });
  }
  const diagnostic = createDiagnostic({
    code: "INTERNAL_ERROR",
    summary: "Unexpected Headroom start error",
    detail: error?.message || String(error),
    fixes: [{ label: "Retry the request" }],
  });
  return NextResponse.json(toDiagnosticResponse(diagnostic), { status: 500 });
}

export async function POST() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    if (!isLoopbackHeadroomUrl(url)) {
      const diagnostic = createDiagnostic({
        code: "EXTERNAL_PROXY",
        summary: "Headroom proxy URL points outside loopback",
        detail: `The configured Headroom URL ${url} is not loopback. External proxies must be started outside DurinDoor.`,
        fixes: [
          { label: "Point headroomUrl at a loopback address in settings", command: "headroomUrl=http://localhost:8787" },
        ],
      });
      return NextResponse.json(toDiagnosticResponse(diagnostic), { status: isUserFixable(diagnostic.code) ? 400 : 500 });
    }
    const port = parsePortFromUrl(url) || 8787;
    const result = await startHeadroomProxy({ port });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.code === "EARLY_EXIT" && !(error instanceof SetupError)) {
      const diagnostic = createDiagnostic({
        code: "EARLY_EXIT",
        summary: "Headroom proxy exited during startup",
        detail: error.message,
        fixes: [{ label: "Inspect the Headroom proxy log" }],
        logTail: getHeadroomLogTail(40),
      });
      return NextResponse.json(toDiagnosticResponse(diagnostic), { status: isUserFixable(diagnostic.code) ? 400 : 500 });
    }
    return respondWithError(error);
  }
}
