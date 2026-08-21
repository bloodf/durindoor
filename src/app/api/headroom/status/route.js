import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL, getHeadroomStatus } from "@/lib/headroom/detect";
import { getManagedPid } from "@/lib/headroom/process";
import { getHeadroomStatusStats } from "../../../../../open-sse/rtk/headroomCircuit.js";
import { SetupError, createDiagnostic, isUserFixable, toDiagnosticResponse } from "@/shared/utils/setupDiagnostics";

export const dynamic = "force-dynamic";

function respondWithError(error) {
  if (error instanceof SetupError) {
    const status = isUserFixable(error.code) ? 400 : 500;
    return NextResponse.json(toDiagnosticResponse(error.diagnostic), { status });
  }
  const diagnostic = createDiagnostic({
    code: "INTERNAL_ERROR",
    summary: "Unexpected Headroom status error",
    detail: error?.message || String(error),
    fixes: [{ label: "Retry the request" }],
  });
  return NextResponse.json(toDiagnosticResponse(diagnostic), { status: 500 });
}

export async function GET() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    const status = await getHeadroomStatus(url);
    const managedPid = getManagedPid();
    return NextResponse.json({ ...status, url, managedPid, circuit: getHeadroomStatusStats() });
  } catch (error) {
    return respondWithError(error);
  }
}
