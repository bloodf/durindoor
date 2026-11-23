import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSettings } from "@/lib/localDb";
import { verifyDashboardPassword, isUsingDefaultPassword } from "@/lib/auth/dashboardSession";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { hasExactRequestOrigin } from "@/lib/auth/requestOrigin";
import { generateTotpSecret, buildOtpAuthUri } from "@/lib/auth/totp";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Begin enrollment (decolua/9router#4144): mint a candidate secret and render
 * its QR. Nothing is persisted here -- the secret only takes effect once the
 * user proves they can generate a code from it (POST /api/auth/mfa/enable).
 */
export async function POST(request) {
  try {
    if (!hasExactRequestOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin request is not allowed" }, { status: 403, headers: NO_STORE_HEADERS });
    }

    const settings = await getSettings();
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) return NextResponse.json({ error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter }, { status: 429, headers: { "Retry-After": String(lock.retryAfter), ...NO_STORE_HEADERS } });
    if (settings.mfaEnabled === true) {
      return NextResponse.json(
        { error: "MFA is already enabled. Disable it first to re-enroll." },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    // Re-auth: an unattended session must not be able to bind a new factor.
    const { password } = await request.json();
    if (await isUsingDefaultPassword(settings) || !(await verifyDashboardPassword(password))) {
      recordFail(ip);
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    recordSuccess(ip);

    const secret = generateTotpSecret();
    const otpauthUri = buildOtpAuthUri({ secret, account: "admin" });
    const qrCodeDataUri = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 });

    return NextResponse.json(
      { secret, otpauthUri, qrCodeDataUri },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[auth] mfa setup failed", error);
    return NextResponse.json({ error: "MFA setup failed" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
