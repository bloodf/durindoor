import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL, getHeadroomStatus } from "@/lib/headroom/detect";
import { getManagedPid } from "@/lib/headroom/process";
import { getHeadroomStatusStats } from "../../../../../open-sse/rtk/headroomCircuit.js";
import { SetupError, createDiagnostic, isUserFixable, toDiagnosticResponse } from "@/shared/utils/setupDiagnostics";
import { isOperatorRequest } from "@/dashboardGuard";
import { redactProxyUrlCredentials } from "@/shared/utils/proxyUrlRedaction.js";

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

export async function GET(request) {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    const status = await getHeadroomStatus(url);
    const managedPid = getManagedPid();
    // headroomUrl may embed `user:password@`. The management gate accepts an
    // application API key, which is an inference credential rather than an
    // operator session, so its userinfo is redacted for that caller.
    const privileged = await isOperatorRequest(request);
    return NextResponse.json({
      ...status,
      url: privileged ? url : redactProxyUrlCredentials(url),
      managedPid,
      circuit: getHeadroomStatusStats(),
    });
  } catch (error) {
    return respondWithError(error);
  }
}
