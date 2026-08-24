import { isBrowser } from "../../../../../shared/utils/typeChecks.js";
const CUSTOM_LAST_KEY = "durindoor.cliToolEndpointCustom";

/** Display both user label and endpoint when they differ. */
export function formatEndpointPresetLabel({ name, baseUrl }) {
  return name === baseUrl ? baseUrl : `${name} — ${baseUrl}`;
}

/** Read last manual endpoint without failing when storage is unavailable. */
export function readLastCustomUrl() {
  if (!isBrowser()) return "";
  try {return window.localStorage.getItem(CUSTOM_LAST_KEY) || "";} catch {return "";}
}

/** Persist last non-empty manual endpoint for later Custom URL selections. */
export function writeLastCustomUrl(url) {
  if (!isBrowser() || !url) return;
  try {window.localStorage.setItem(CUSTOM_LAST_KEY, url);} catch {/* storage unavailable */}
}