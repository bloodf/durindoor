import { NextResponse } from "next/server";
import { HEADROOM_COMPRESSION_EXTRAS, getInstalledHeadroomExtras } from "@/lib/headroom/detect";
import { installHeadroomExtras } from "@/lib/headroom/process";
import { managedVenvPython, describeExternalInstall } from "@/lib/headroom/pythonEnv";
import { SetupError, createDiagnostic, isUserFixable, toDiagnosticResponse } from "@/shared/utils/setupDiagnostics";

export const dynamic = "force-dynamic";

function respondWithError(error) {
  if (error instanceof SetupError) {
    const status = isUserFixable(error.code) ? 400 : 500;
    return NextResponse.json(toDiagnosticResponse(error.diagnostic), { status });
  }
  const diagnostic = createDiagnostic({
    code: "INTERNAL_ERROR",
    summary: "Unexpected Headroom extras error",
    detail: error?.message || String(error),
    fixes: [{ label: "Retry the request" }],
  });
  return NextResponse.json(toDiagnosticResponse(diagnostic), { status: 500 });
}

export async function GET() {
  try {
    const python = managedVenvPython();
    const status = python ? getInstalledHeadroomExtras(python) : { installed: false, version: null, extras: { code: false, ml: false } };
    return NextResponse.json({
      available: HEADROOM_COMPRESSION_EXTRAS,
      ...status,
      source: python ? "managed" : null,
      externalInstall: describeExternalInstall(),
    });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const requested = Array.isArray(body?.extras) ? body.extras : [];
    const result = await installHeadroomExtras(requested);
    return NextResponse.json(result);
  } catch (error) {
    return respondWithError(error);
  }
}
