import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { hasExactRequestOrigin } from "@/lib/auth/requestOrigin";
import { verifyTotpCode } from "@/lib/auth/totp";
import { generateBackupCodes } from "@/lib/auth/backupCodes";
import { isString } from "@/shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Finish enrollment (decolua/9router#4144): accept the candidate secret only
 * after it produces a valid code, then persist it alongside a fresh set of
 * backup codes. The plaintext backup codes are returned exactly once.
 */
export async function POST(request) {
  try {
    if (!hasExactRequestOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin request is not allowed" }, { status: 403, headers: NO_STORE_HEADERS });
    }

    const settings = await getSettings();
    if (settings.mfaEnabled === true) {
      return NextResponse.json(
        { error: "MFA is already enabled. Disable it first to re-enroll." },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const { password, secret, code } = await request.json();

    if (!(await verifyDashboardPassword(password))) {
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    if (!isString(secret) || !secret) {
      return NextResponse.json(
        { error: "Missing enrollment secret. Restart setup." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    // Proves the authenticator actually holds the secret before we lock the
    // account behind it.
    if (!verifyTotpCode(secret, code)) {
      return NextResponse.json(
        { error: "Invalid code. Check your authenticator and try again." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const { codes, hashes } = await generateBackupCodes();
    await updateSettings({ mfaEnabled: true, mfaSecret: secret, mfaBackupCodes: hashes });

    return NextResponse.json(
      { success: true, backupCodes: codes },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[auth] mfa enable failed", error);
    return NextResponse.json({ error: "MFA enable failed" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
