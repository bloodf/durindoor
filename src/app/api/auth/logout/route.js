import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  clearDashboardAuthCookie,
  rotateDashboardSessionEpoch,
  verifyDashboardAuthToken,
} from "@/lib/auth/dashboardSession";
import { hasExactRequestOrigin } from "@/lib/auth/requestOrigin";

export async function POST(request) {
  const cookieStore = await cookies();
  const authToken = request.cookies?.get("auth_token")?.value ?? request.headers.get("cookie")
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("auth_token="))
    ?.slice("auth_token=".length);
  const hasSameOrigin = Boolean(request.headers.get("origin")) && hasExactRequestOrigin(request);
  if (hasSameOrigin && await verifyDashboardAuthToken(authToken)) {
    await rotateDashboardSessionEpoch();
  }
  clearDashboardAuthCookie(cookieStore);
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
