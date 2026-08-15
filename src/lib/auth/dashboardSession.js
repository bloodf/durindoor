import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";

export const DEFAULT_PASSWORD = "123456";

// Built-in default is "active" whenever the effective password literally
// resolves to DEFAULT_PASSWORD — a stored hash of it, or an INITIAL_PASSWORD
// env var set to it, or no password source configured at all.
// The boolean result is cached for the lifetime of the process; callers MUST
// invoke `invalidateDefaultPasswordCache()` after persisting a new password
// hash or clearing the stored one, otherwise the public /api/auth/status
// endpoint would re-run bcrypt cost-10 on every GET.
// Cache the in-flight compute so concurrent callers during cold cache do
// not each kick off cost-10 bcrypt. The `promise` slot is reused until the
// call resolves; a rejected call clears both slots so a later GET retries
// instead of getting a stuck "false" answer.
//
// Keyed by the effective password source (stored hash, or INITIAL_PASSWORD
// value) rather than just "populated": if the source changes between calls
// without an explicit invalidate, the cache still recomputes instead of
// serving a stale answer for a different password. `generation` guards a
// slow in-flight compute from clobbering the slot after an explicit
// invalidate fires mid-flight — the stale result is still returned to its
// own caller, it just never gets published.
let cacheGeneration = 0;
let defaultPasswordCache = { key: null, value: null, populated: false, promise: null };

function effectivePasswordKey(settings) {
  if (settings?.password) return `hash:${settings.password}`;
  return `env:${process.env.INITIAL_PASSWORD ?? ""}`;
}

export function invalidateDefaultPasswordCache() {
  cacheGeneration += 1;
  defaultPasswordCache = { key: null, value: null, populated: false, promise: null };
}

export async function isUsingDefaultPassword(settings) {
  const key = effectivePasswordKey(settings);
  if (defaultPasswordCache.key === key) {
    if (defaultPasswordCache.populated) return defaultPasswordCache.value;
    if (defaultPasswordCache.promise) return defaultPasswordCache.promise;
  }
  const generation = cacheGeneration;
  const promise = (async () => {
    try {
      let result;
      if (settings?.password) {
        result = await bcrypt.compare(DEFAULT_PASSWORD, settings.password);
      } else {
        const initialPassword = process.env.INITIAL_PASSWORD;
        result = !initialPassword || initialPassword === DEFAULT_PASSWORD;
      }
      if (cacheGeneration === generation) {
        defaultPasswordCache = { key, value: result, populated: true, promise: null };
      }
      return result;
    } catch (error) {
      if (cacheGeneration === generation) {
        defaultPasswordCache = { key: null, value: null, populated: false, promise: null };
      }
      throw error;
    }
  })();
  defaultPasswordCache = { key, value: null, populated: false, promise };
  return promise;
}

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  const passwordSessionEpoch = claims.oidc
    ? undefined
    : (claims.passwordSessionEpoch ?? (await getSettings()).passwordSessionEpoch);
  return new SignJWT({
    authenticated: true,
    ...claims,
    ...(passwordSessionEpoch === undefined ? {} : { passwordSessionEpoch }),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (payload.oidc) return true;
    const settings = await getSettings();
    return payload.passwordSessionEpoch === settings.passwordSessionEpoch;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (payload.oidc) return payload;
    const settings = await getSettings();
    return payload.passwordSessionEpoch === settings.passwordSessionEpoch ? payload : null;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return password === initialPassword;
}
