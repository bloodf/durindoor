import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { isUsingDefaultPassword, setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { issuePasswordChangeProof } from "@/lib/auth/passwordChangeProof";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { hasExactRequestOrigin, hasTrustedLocalOrigin } from "@/lib/auth/requestOrigin";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";

const RESET_HINT = "Forgot password? Reset to default via DurinDoor CLI → Settings → Reset Password to Default.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}


export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }
    if (!hasExactRequestOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin login is not allowed" }, { status: 403, headers: NO_STORE_HEADERS });
    }

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
      isValid = password === initialPassword;
    }

    if (isValid) {
      // Default password still in use: never issue a normal dashboard
      // session on it. Remote clients are rejected outright; local clients
      // get a short-lived, single-use, IP-bound proof that only the
      // change-password endpoint accepts.
      const mustChangePassword = await isUsingDefaultPassword(settings);
      if (mustChangePassword) {
        if (!isLocalRequest(request) || !hasTrustedLocalOrigin(request) || !hasExactRequestOrigin(request)) {
          recordFail(ip);
          const postLock = checkLock(ip);
          if (postLock.locked) {
            return NextResponse.json(
              { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
              { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
            );
          }
          return NextResponse.json({ success: true, mustChangePassword: true }, { status: 403, headers: NO_STORE_HEADERS });
        }
        recordFail(ip);
        const postLock = checkLock(ip);
        if (postLock.locked) {
          return NextResponse.json(
            { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
            { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
          );
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
      const currentSettings = await getSettings();
      if ((currentSettings.passwordSessionEpoch ?? "initial") !== (settings.passwordSessionEpoch ?? "initial")) {
        return NextResponse.json({ error: "Login state changed, please retry" }, { status: 409, headers: NO_STORE_HEADERS });
      }
      const cookieStore = await cookies();
      try {
        await setDashboardAuthCookie(cookieStore, request, { passwordSessionEpoch: settings.passwordSessionEpoch ?? "initial" }, async () => {
          const after = await getSettings();
          if ((after.passwordSessionEpoch ?? "initial") !== (settings.passwordSessionEpoch ?? "initial")) {
            throw new Error("LOGIN_EPOCH_RACE");
          }
        });
        recordSuccess(ip);
        return NextResponse.json({ success: true, mustChangePassword: false }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error && error.message === "LOGIN_EPOCH_RACE") {
          return NextResponse.json({ error: "Login state changed, please retry" }, { status: 409, headers: NO_STORE_HEADERS });
        }
        throw error;
      }
    }


    const { remainingBeforeLock } = recordFail(ip);
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
      );
    }
    return NextResponse.json(
      { error: `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
      { status: 401 }
    );
  } catch {
    console.error("[auth] login failed");
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
