import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { isUndefined } from "../../../../shared/utils/typeChecks.js";

export const DATA_RETENTION_PRESETS = [7, 15, 30, 60, 90];
export const MODEL_AUTO_SYNC_INTERVALS = [
  { value: 0, label: "Off" },
  { value: 6, label: "Every 6 hours" },
  { value: 12, label: "Every 12 hours" },
  { value: 24, label: "Every day" },
  { value: 72, label: "Every 3 days" },
  { value: 168, label: "Every week" },
];
export const SETTINGS_TABS = [
  { value: "general", label: "General", icon: "tune" },
  { value: "security", label: "Security", icon: "shield_lock" },
  { value: "routing", label: "Routing", icon: "route" },
  { value: "network", label: "Network", icon: "lan" },
  { value: "system", label: "System & Data", icon: "storage" },
];

export function describeRetentionRun(run) {
  if (!run?.ranAt) return "";
  const deleted = run.deleted || {};
  const total = Object.values(deleted).reduce((sum, count) => sum + (Number(count) || 0), 0);
  const when = new Date(run.ranAt).toLocaleString();
  const detail = Object.entries(deleted).map(([store, count]) => `${store} ${count}`).join(", ");
  const failed = run.errors ? ` Some stores failed: ${Object.keys(run.errors).join(", ")}.` : "";
  return `Last cleanup ${when}: removed ${total} records older than ${run.days} days${detail ? ` (${detail})` : ""}.${failed}`;
}

export function getLocaleFromCookie() {
  if (isUndefined(globalThis.document)) return "en";
  const cookie = document.cookie.
  split(";").
  find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

/** Split a comma/newline separated allowlist field into trimmed entries (#2195). */
export function splitOidcAllowlist(value) {
  return String(value || "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

/** Saved OIDC allowlist arrays as editable textarea drafts. */
export function oidcAllowlistDraft(data) {
  const join = (list) => (Array.isArray(list) ? list.join("\n") : "");
  return {
    oidcAllowedSubjects: join(data?.oidcAllowedSubjects),
    oidcAllowedEmails: join(data?.oidcAllowedEmails),
    oidcAllowedDomains: join(data?.oidcAllowedDomains)
  };
}

export const statusClass = (status) => status?.type === "error" ? "text-dd-danger" : "text-dd-success";

export const AUTH_OPTIONS = [
  { value: "password", label: "Password only", hint: "Keep the legacy password login." },
  { value: "oidc", label: "OIDC only", hint: "Require OIDC for dashboard access." },
  { value: "both", label: "Both", hint: "Allow either password or OIDC." },
];
