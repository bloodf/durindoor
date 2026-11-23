import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearDashboardAuthCookie, rotateDashboardSessionEpoch } from "@/lib/auth/dashboardSession";

export async function POST() {
  const cookieStore = await cookies();
  await rotateDashboardSessionEpoch();
  clearDashboardAuthCookie(cookieStore);
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
