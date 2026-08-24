import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { hasValidCliToken } from "@/dashboardGuard";
import { isFunction } from "@/shared/utils/typeChecks.js";

/**
 * Secrets that must never be mass-assigned from a PATCH body. Password
 * rotation re-injects `password` / `passwordSessionEpoch` only after
 * `currentPassword` verification in the settings route.
 */
export const SECRET_SETTING_KEYS = Object.freeze([
  "password",
  "passwordSessionEpoch",
  "mitmSudoEncrypted",
]);

/**
 * Auth, SSO, proxy, and observability settings that must not be writable
 * via mass assignment unless the caller proves dashboard or CLI identity.
 * Keys absent from durindoor settings are intentionally omitted.
 */
export const AUTH_CRITICAL_SETTING_KEYS = Object.freeze([
  "requireLogin",
  "authMode",
  "oidcIssuerUrl",
  "oidcClientId",
  "oidcClientSecret",
  "oidcScopes",
  "oidcLoginLabel",
  "tunnelDashboardAccess",
  "enableObservability",
  "outboundProxyEnabled",
  "outboundProxyUrl",
  "outboundNoProxy",
]);

/**
 * True when the caller may persist {@link AUTH_CRITICAL_SETTING_KEYS}.
 * Deliberately ignores the requireLogin=false dashboard guard bypass —
 * only a valid dashboard JWT or machine-bound CLI token qualifies.
 */
export async function canModifySecurityCriticalSettings(request) {
  if (!request || !isFunction(request.headers?.get)) return false;
  try {
    if (await hasValidCliToken(request)) return true;
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    return await verifyDashboardAuthToken(token);
  } catch {
    return false;
  }
}

/**
 * Remove keys from `body` when present. Returns whether any key was removed.
 */
export function stripSettingKeys(body, keys) {
  let stripped = false;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      delete body[key];
      stripped = true;
    }
  }
  return stripped;
}
