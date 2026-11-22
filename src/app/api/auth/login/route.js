import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { isUsingDefaultPassword, setDashboardAuthCookie, setMfaPendingCookie } from "@/lib/auth/dashboardSession";
import { isMfaEnabled } from "@/lib/auth/mfa";
import { issuePasswordChangeProof } from "@/lib/auth/passwordChangeProof";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { hasExactRequestOrigin, hasTrustedLocalOrigin } from "@/lib/auth/requestOrigin";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import * as loginLimiter from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";
import { timingSafeCompare } from "@/shared/utils/timingSafeCompare";
import { isFunction } from "@/shared/utils/typeChecks";

const RESET_HINT = "Forgot password? Reset to default via DurinDoor CLI → Settings → Reset Password to Default.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

function lockedResponse(lock) {
  return NextResponse.json(
    { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
    { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
  );
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    // Refuse while already locked before touching the body.
    const preLock = checkLock(ip);
    if (preLock.locked) return lockedResponse(preLock);
    if (!hasExactRequestOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin login is not allowed" }, { status: 403, headers: NO_STORE_HEADERS });
    }

    // Reserve a failure slot synchronously before any await so concurrent
    // bursts cannot all pass checkLock, evaluate credentials, then race
    // recordFail (issue #2242).
    const { remainingBeforeLock } = recordFail(ip);
    const reservedLock = checkLock(ip);
    if (reservedLock.locked) return lockedResponse(reservedLock);

    const { password } = await request.json();
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    // Default password is '123456' if not set
    const storedHash = settings.password;

    if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
      return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
    }

    let isValid = false;
    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      // Use env var or default
      const initialPassword = process.env.INITIAL_PASSWORD || "123456";
      isValid = timingSafeCompare(password, initialPassword);
    }

    if (isValid) {
      // Default password still in use: never issue a normal dashboard
      // session on it. Remote clients are rejected outright; local clients
      // get a short-lived, single-use, IP-bound proof that only the
      // change-password endpoint accepts.
      const mustChangePassword = await isUsingDefaultPassword(settings);
      if (mustChangePassword) {
        const postLock = checkLock(ip);
        if (postLock.locked) return lockedResponse(postLock);
        if (!isLocalRequest(request) || !hasTrustedLocalOrigin(request) || !hasExactRequestOrigin(request)) {
          return NextResponse.json({ success: true, mustChangePassword: true }, { status: 403, headers: NO_STORE_HEADERS });
        }
        const proof = issuePasswordChangeProof(ip, settings.passwordSessionEpoch ?? "initial");
        if (!proof) {
          return NextResponse.json({ error: "Password change already in progress" }, { status: 409, headers: NO_STORE_HEADERS });
        }
        return NextResponse.json(
          { success: true, mustChangePassword: true, requiresPasswordChange: true, proof },
          { status: 403, headers: NO_STORE_HEADERS }
        );
      }
      // Concurrent reservations may have locked the bucket while bcrypt ran —
      // never clear the lock or issue a session in that case.
      const successLock = checkLock(ip);
      if (successLock.locked) return lockedResponse(successLock);

      const currentSettings = await getSettings();
      if ((currentSettings.passwordSessionEpoch ?? "initial") !== (settings.passwordSessionEpoch ?? "initial")) {
        return NextResponse.json({ error: "Login state changed, please retry" }, { status: 409, headers: NO_STORE_HEADERS });
      }
      const cookieStore = await cookies();

      // Password is only the first factor. When MFA is on, hand back a
      // short-lived pending token instead of a session -- it carries no
      // `authenticated` claim, so it cannot reach the dashboard on its own.
      // Deliberately do NOT clear the failure counter here: the login is not
      // complete, and resetting it would hand an attacker a fresh lockout
      // budget for brute-forcing the second factor.
      if (isMfaEnabled(currentSettings)) {
        // Undo the pre-await reservation only; do not recordSuccess (that would
        // reset prior fails and hand the attacker a fresh TOTP budget).
        if (isFunction(loginLimiter.releaseReservation)) {
          loginLimiter.releaseReservation(ip);
        }
        await setMfaPendingCookie(cookieStore, request);
        return NextResponse.json(
          { success: false, mfaRequired: true, mustChangePassword: false },
          { headers: NO_STORE_HEADERS }
        );
      }

      try {
        await setDashboardAuthCookie(cookieStore, request, { passwordSessionEpoch: settings.passwordSessionEpoch ?? "initial" }, settings.passwordSessionEpoch ?? "initial");
        recordSuccess(ip);
        return NextResponse.json({ success: true, mustChangePassword: false }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error && error.message === "AUTH_EPOCH_RACE") {
          return NextResponse.json({ error: "Login state changed, please retry" }, { status: 409, headers: NO_STORE_HEADERS });
        }
        throw error;
      }
    }

    // Failure was already reserved above; only choose the response shape.
    const postLock = checkLock(ip);
    if (postLock.locked) return lockedResponse(postLock);
    return NextResponse.json(
      { error: `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
      { status: 401 }
    );
  } catch {
    console.error("[auth] login failed");
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
