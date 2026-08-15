import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getClientIp } from "@/lib/auth/loginLimiter";
import {
  invalidateDefaultPasswordCache,
  setDashboardAuthCookie,
  validateDashboardPassword,
} from "@/lib/auth/dashboardSession";
import {
  commitPasswordChangeProof,
  releasePasswordChangeProof,
  reservePasswordChangeProof,
} from "@/lib/auth/passwordChangeProof";
import { updateSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { proof, newPassword } = await request.json().catch(() => ({}));
    if (typeof proof !== "string" || !proof) {
      return NextResponse.json({ error: "Missing password-change proof" }, { status: 403 });
    }
    const validation = validateDashboardPassword(newPassword);
    if (validation) {
      return NextResponse.json({ error: validation }, { status: 400 });
    }

    const ip = getClientIp(request);
    if (!reservePasswordChangeProof(proof, ip)) {
      return NextResponse.json({ error: "Invalid or expired password-change proof" }, { status: 403 });
    }

    try {
      const salt = await bcrypt.genSalt(10);
      const password = await bcrypt.hash(newPassword, salt);
      const newEpoch = crypto.randomBytes(16).toString("hex");
      await updateSettings({ password, passwordSessionEpoch: newEpoch });
      invalidateDefaultPasswordCache();
      commitPasswordChangeProof(proof);

      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request);

      return NextResponse.json({ success: true });
    } catch (error) {
      releasePasswordChangeProof(proof);
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
