import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { updateSettings } from "@/lib/localDb";
import { invalidateDefaultPasswordCache } from "@/lib/auth/dashboardSession";
import { resetPasswordChangeProofs } from "@/lib/auth/passwordChangeProof";

// Reset dashboard password to default by clearing the stored hash.
// Local-only (enforced by dashboardGuard). Never returns the default literal.
export async function POST() {
  try {
    await updateSettings({ password: null, passwordSessionEpoch: crypto.randomBytes(16).toString("hex") });
    invalidateDefaultPasswordCache();
    resetPasswordChangeProofs();
    return NextResponse.json({ success: true });
  } catch {
    console.error("[auth] password reset failed");
    return NextResponse.json({ error: "Password reset failed" }, { status: 500 });
  }
}
