import { hasExactRequestOrigin, hasTrustedLocalOrigin } from "@/lib/auth/requestOrigin";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { updateSettings } from "@/lib/localDb";
import { invalidateDefaultPasswordCache } from "@/lib/auth/dashboardSession";
import { resetPasswordChangeProofs } from "@/lib/auth/passwordChangeProof";

import { hasValidCliToken, isLocalRequest } from "@/dashboardGuard";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// Reset dashboard password to default by clearing the stored hash.
// Local-only (enforced by dashboardGuard). The browser origin must be
// allowlisted loopback with matching Host to defeat DNS-rebinding CSRF.
// Never returns the default literal.
export async function POST(request) {
  try {
    if (!isLocalRequest(request) || (!await hasValidCliToken(request) && (!hasExactRequestOrigin(request) || !hasTrustedLocalOrigin(request)))) {
      console.error("[auth] password reset denied");
      return NextResponse.json({ error: "Password reset denied" }, { status: 403, headers: NO_STORE_HEADERS });
    }
    await updateSettings({ password: null, passwordSessionEpoch: crypto.randomBytes(16).toString("hex") });
    invalidateDefaultPasswordCache();
    resetPasswordChangeProofs();
    return NextResponse.json({ success: true });
  } catch {
    console.error("[auth] password reset failed");
    return NextResponse.json({ error: "Password reset failed" }, { status: 500 });
  }
}
