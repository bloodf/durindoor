import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { updateSettings } from "@/lib/localDb";
import { invalidateDefaultPasswordCache } from "@/lib/auth/dashboardSession";

// Reset dashboard password to default by clearing the stored hash.
// Local-only (enforced by dashboardGuard). Never returns the default literal.
export async function POST() {
  try {
    await updateSettings({ password: null, passwordSessionEpoch: crypto.randomBytes(16).toString("hex") });
    invalidateDefaultPasswordCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
