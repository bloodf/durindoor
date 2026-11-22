import { isString } from "./typeChecks.js";

// Optional target version for the in-app updater (9router #1686).
// Returns "" for "no target" (latest), the bare semver for a valid one, or null
// for anything that is not a plain semver, so it can never reach the npm spec.
export function normalizeTargetVersion(version) {
  if (version === undefined || version === null || version === "") return "";
  if (!isString(version)) return null;
  const normalized = version.trim().replace(/^v/i, "");
  if (normalized === "") return "";
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized) ? normalized : null;
}

export function formatUpdaterPackageSpec(packageName, version) {
  return `${packageName}@${version || "latest"}`;
}
