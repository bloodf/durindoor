import { NextResponse } from "next/server";
import { isHosted } from "@/shared/utils/deploymentMode";

export function GET() {
  return NextResponse.json({ hosted: isHosted() }, { headers: { "Cache-Control": "no-store" } });
}
