import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings, getSettingsSync } from "@/lib/localDb";
import { isString } from "../../shared/utils/typeChecks.js";

export const DEFAULT_PASSWORD = "123456";

/** Basename of the legacy on-disk JWT secret under DATA_DIR. */
export const JWT_SECRET_FILE_BASENAME = "jwt-secret";

export function validateDashboardPassword(password) {
  if (!isString(password) || password.length < 6) {
    return "Password must be at least 6 characters";
  }
  if (password === DEFAULT_PASSWORD) return "Password must not use the built-in default";
  return null;
}

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

/**
 * Resolve the JWT signing secret for dashboard session cookies.
 *
 * SECURITY (independent re-implementation of GHSA-jphh / 9router #3501):
 * never mint a new on-disk secret. Silent auto-generation made it easy to
 * deploy without an intentional secret and lose session integrity across hosts.
 *
 * Resolution order:
 *   1. process.env.JWT_SECRET — operator-supplied, wins in all modes.
 *   2. Existing DATA_DIR/jwt-secret — legacy file from older DurinDoor /
 *      9router installs; reused with a warning so existing DATA_DIR installs
 *      are not bricked. Operators should copy the value into JWT_SECRET.
 *   3. Throw — refuse to sign or verify sessions without an explicit source.
 *
 * @returns {string} secret string (never logged).
 */
export function loadJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (isString(fromEnv) && fromEnv.length > 0) {
    return fromEnv;
  }

  const secretPath = path.join(DATA_DIR, JWT_SECRET_FILE_BASENAME);
  let existing = null;
  try {
    existing = fs.readFileSync(secretPath, "utf8").trim();
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
  if (existing) {
    console.warn(
      "[auth] JWT_SECRET unset — using existing DATA_DIR/" +
        JWT_SECRET_FILE_BASENAME +
        ". Set JWT_SECRET explicitly in production.",
    );
    return existing;
  }

  throw new Error(
    "JWT_SECRET environment variable is required. Set a strong random secret " +
      "(e.g. openssl rand -hex 32). Legacy installs may keep an existing " +
      "DATA_DIR/jwt-secret file; DurinDoor no longer auto-generates that file.",
  );
}

let cachedSecretBytes = null;

function getSecretBytes() {
  if (!cachedSecretBytes) {
    cachedSecretBytes = new TextEncoder().encode(loadJwtSecret());
  }
  return cachedSecretBytes;
}

/** Test-only: clear the cached encoded secret so the next call re-resolves. */
export function __resetJwtSecretForTests() {
  cachedSecretBytes = null;
}

export function shouldUseSecureCookie(request) {
  if (process.env.AUTH_COOKIE_SECURE === "true") return true;
  const configuredBaseUrl = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (configuredBaseUrl) {
    try {
      return new URL(configuredBaseUrl).protocol === "https:";
    } catch {
      return false;
    }
  }
  return request?.url ? new URL(request.url).protocol === "https:" : false;
}

export async function createDashboardAuthToken(claims = {}) {
  const passwordSessionEpoch = claims.oidc ?
  undefined :
  claims.passwordSessionEpoch ?? (await getSettings()).passwordSessionEpoch;
  const jwtPayload = {
    authenticated: true,
    ...claims,
  };
  if (passwordSessionEpoch !== undefined) {
    jwtPayload.passwordSessionEpoch = passwordSessionEpoch;
  }
  return new SignJWT(jwtPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(getSecretBytes());
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSecretBytes());
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
    const { payload } = await jwtVerify(token, getSecretBytes());
    if (payload.oidc) return payload;
    const settings = await getSettings();
    return payload.passwordSessionEpoch === settings.passwordSessionEpoch ? payload : null;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}, expectedPasswordSessionEpoch) {
  const token = await createDashboardAuthToken(claims);
  if (expectedPasswordSessionEpoch !== undefined) {
    const settings = getSettingsSync();
    if (settings.passwordSessionEpoch !== expectedPasswordSessionEpoch) {
      throw new Error("AUTH_EPOCH_RACE");
    }
  }
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/"
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (!isString(password) || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return password === initialPassword;
}