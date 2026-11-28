/**
 * Saved browser state that would outlive a replaced cookie (#2034).
 *
 * The ChatGPT Web browser transport reads `providerSpecificData.storageState`
 * before the stored Cookie header (`readStorageState` in
 * open-sse/utils/chatgptWebExecutorAdapter.js). When an import or an Edit
 * replaces the cookie of a connection that still holds a saved storage state,
 * that state must go too, or the browser keeps the old session while the HTTP
 * transport sends the new one.
 *
 * Only these providers keep a saved storage state. Other providers and other
 * providerSpecificData fields are never touched.
 */
import { isRecord, isString } from "@/shared/utils/typeChecks";

const SAVED_BROWSER_STATE_PROVIDERS = new Set(["chatgpt-web", "chatgpt-web-codex"]);

const hasSavedBrowserState = (connection) =>
  isRecord(connection?.providerSpecificData) && connection.providerSpecificData.storageState != null;

/**
 * Decide whether replacing `existing.apiKey` with `nextApiKey` must clear the saved browser state.
 *
 * Returns null when nothing changes: another provider, no saved state, or the same cookie again.
 * Otherwise returns the providerSpecificData patch and a compare-and-swap guard. Pass the guard as
 * `shouldCommitConnection` (with `returnCommitResult: true`) so the write applies only while the row
 * still holds the cookie this decision was based on; a concurrent change is refused, not overwritten.
 *
 * @param {object|null|undefined} existing the connection row read before the write
 * @param {unknown} nextApiKey the replacement Cookie header
 * @returns {{ providerSpecificData: { storageState: null }, shouldCommitConnection: (row: object) => boolean } | null}
 */
export function savedBrowserStateInvalidation(existing, nextApiKey) {
  if (!SAVED_BROWSER_STATE_PROVIDERS.has(existing?.provider) || existing.authType !== "cookie") return null;
  if (!isString(nextApiKey) || !nextApiKey.trim() || nextApiKey === existing.apiKey) return null;
  if (!hasSavedBrowserState(existing)) return null;
  const { id, provider, apiKey } = existing;
  return {
    providerSpecificData: { storageState: null },
    shouldCommitConnection: (row) => Boolean(row) && row.id === id && row.provider === provider && row.apiKey === apiKey,
  };
}
