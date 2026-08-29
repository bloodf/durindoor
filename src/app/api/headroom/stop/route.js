import { NextResponse } from "next/server";
import { stopHeadroomProxy } from "@/lib/headroom/process";
import { SetupError, createDiagnostic, isUserFixable, toDiagnosticResponse } from "@/shared/utils/setupDiagnostics";

export const dynamic = "force-dynamic";

function respondWithError(error) {
  if (error instanceof SetupError) {
    const status = isUserFixable(error.code) ? 400 : 500;
    return NextResponse.json(toDiagnosticResponse(error.diagnostic), { status });
  }
  const code = error?.code;
  if (code === "STOP_FAILED") {
    const diagnostic = createDiagnostic({
      code: "STOP_FAILED",
      summary: "Failed to stop the Headroom proxy",
      detail: error.message,
      fixes: [{ label: "Verify the managed Headroom process and retry" }],
    });
    return NextResponse.json(toDiagnosticResponse(diagnostic), { status: 500 });
  }
  const diagnostic = createDiagnostic({
    code: "INTERNAL_ERROR",
    summary: "Unexpected Headroom stop error",
    detail: error?.message || String(error),
    fixes: [{ label: "Retry the request" }],
  });
  return NextResponse.json(toDiagnosticResponse(diagnostic), { status: 500 });
}

export async function POST() {
  try {
    const result = await stopHeadroomProxy();
    const status = result.stopped ? 200 : 409;
    return NextResponse.json({ ...result }, { status });
  } catch (error) {
    return respondWithError(error);
  }
}
