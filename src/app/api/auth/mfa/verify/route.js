import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import {
  MFA_PENDING_COOKIE,
  getMfaPendingSession,
  setDashboardAuthCookie,
  clearMfaPendingCookie,
} from "@/lib/auth/dashboardSession";
import { hasExactRequestOrigin } from "@/lib/auth/requestOrigin";
import { verifySecondFactor } from "@/lib/auth/mfa";
import {
  checkLock,
  recordFail,
  recordSuccess,
  getClientIp,
  reserveAttempt,
  releaseReservation,
} from "@/lib/auth/loginLimiter";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Login step 2 (decolua/9router#4144): trade a valid second factor for a real
 * dashboard session. Reachable without a session -- dashboardGuard exempts
 * this exact path -- so it must authenticate itself via the mfa_pending
 * cookie and re-check origin/rate limits the same as step 1.
 */
function lockedResponse(lock) {
  return NextResponse.json(
    { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
    { status: 429, headers: { "Retry-After": String(lock.retryAfter), ...NO_STORE_HEADERS } },
  );
}

export async function POST(request) {
  let ip;
  let settled = true;
  try {
    if (!hasExactRequestOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin request is not allowed" }, { status: 403, headers: NO_STORE_HEADERS });
    }

    ip = getClientIp(request);

    // Share the password limiter: TOTP has only 10^6 values, so an unthrottled
    // endpoint is the weak point of the whole scheme.
    // Reserve the attempt slot synchronously before any await so concurrent
    // TOTP bursts cannot all evaluate then race recordFail (issue #2242).
    const reserved = reserveAttempt(ip);
    if (reserved.locked) return lockedResponse(reserved);
    settled = false;

    const cookieStore = await cookies();
    const pending = await getMfaPendingSession(cookieStore.get(MFA_PENDING_COOKIE)?.value);
    if (!pending) {
      releaseReservation(ip);
      settled = true;
      return NextResponse.json(
        { error: "MFA session expired. Sign in again." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const { code } = await request.json();
    const result = await verifySecondFactor(code);

    if (!result.ok) {
      const { remainingBeforeLock } = recordFail(ip);
      settled = true;
      const postLock = checkLock(ip);
      if (postLock.locked) return lockedResponse(postLock);
      return NextResponse.json(
        { error: `Invalid code. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    // Refuse success if concurrent confirmed failures locked the bucket mid-verify.
    const successLock = checkLock(ip);
    if (successLock.locked) {
      releaseReservation(ip);
      settled = true;
      return lockedResponse(successLock);
    }

    recordSuccess(ip);
    settled = true;
    clearMfaPendingCookie(cookieStore);

    const settings = await getSettings();
    const passwordSessionEpoch = settings.passwordSessionEpoch ?? "initial";
    try {
      await setDashboardAuthCookie(cookieStore, request, { mfa: result.method, passwordSessionEpoch }, passwordSessionEpoch);
    } catch (error) {
      if (error && error.message === "AUTH_EPOCH_RACE") {
        return NextResponse.json({ error: "Login state changed, please retry" }, { status: 409, headers: NO_STORE_HEADERS });
      }
      throw error;
    }

    return NextResponse.json(
      {
        success: true,
        method: result.method,
        backupCodesRemaining: result.backupCodesRemaining,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error("[auth] mfa verify failed");
    return NextResponse.json({ error: "MFA verification failed" }, { status: 500, headers: NO_STORE_HEADERS });
  } finally {
    if (!settled) releaseReservation(ip);
  }
}
