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
  resetPasswordChangeProofs,
} from "@/lib/auth/passwordChangeProof";
import { PasswordEpochMismatchError, getSettings, updateSettingsWithPasswordEpoch } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { proof, newPassword } = await request.json().catch(() => ({}));
    if (typeof proof !== "string" || !proof) return NextResponse.json({ error: "Missing password-change proof" }, { status: 403 });
    const validation = validateDashboardPassword(newPassword);
    if (validation) return NextResponse.json({ error: validation }, { status: 400 });

    const ip = getClientIp(request);
    const reservation = reservePasswordChangeProof(proof, ip);
    if (!reservation) return NextResponse.json({ error: "Invalid or expired password-change proof" }, { status: 403 });

    try {
      const salt = await bcrypt.genSalt(10);
      const password = await bcrypt.hash(newPassword, salt);
      const newEpoch = crypto.randomBytes(16).toString("hex");
      const expectedEpoch = reservation.passwordSessionEpoch;
      try {
        await updateSettingsWithPasswordEpoch({ password, passwordSessionEpoch: newEpoch }, expectedEpoch);
      } catch (error) {
        if (error instanceof PasswordEpochMismatchError) {
          resetPasswordChangeProofs();
          return NextResponse.json({ error: "Password change conflict, please retry" }, { status: 409 });
        }
        throw error;
      }
      invalidateDefaultPasswordCache();
      commitPasswordChangeProof(proof);
      resetPasswordChangeProofs();
      try {
        const cookieStore = await cookies();
        await setDashboardAuthCookie(cookieStore, request, { passwordSessionEpoch: newEpoch }, async () => {
          const after = await getSettings();
          if (after.passwordSessionEpoch !== newEpoch) throw new Error("CHANGE_EPOCH_RACE");
        });
      } catch (error) {
        if (error?.message === "CHANGE_EPOCH_RACE") {
          return NextResponse.json({ error: "Password change conflict, please retry" }, { status: 409 });
        }
        console.error("[auth] password change cookie failed");
        return NextResponse.json({ success: true, reauthenticate: true });
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      releasePasswordChangeProof(proof);
      throw error;
    }
  } catch {
    console.error("[auth] password change failed");
    return NextResponse.json({ error: "Password change failed" }, { status: 500 });
  }
}
