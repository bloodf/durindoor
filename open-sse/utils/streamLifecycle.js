import { isString } from "../../src/shared/utils/typeChecks.js"; /**
 * Local stream lifecycle classifier (ported from OmniRoute #7907/#7908).
 *
 * When the caller drops the connection mid-stream (combo race loser, model
 * switch, tab close) the in-flight leg surfaces a DOM `AbortError`, or a bare
 * error whose message is `request_signal_aborted` / "Client disconnected" /
 * "operation was aborted" / "controller is already closed". These carry no
 * upstream status, so they default to HTTP 502 and would otherwise be counted
 * as provider failures — cooling down the serving connection and marking a
 * healthy account unavailable from a client-side cancellation alone.
 *
 * Treat them as local lifecycle events: the cooldown / fallback accrual must
 * skip them. Genuine upstream failures (5xx/429/401) still count.
 */
export function isLocalStreamLifecycleError(error) {
  if (!error) return false;
  const name = isString(error?.name) ? error.name : "";
  if (name === "AbortError") return true;
  const message =
  isString(error) ?
  error :
  isString(error?.message) ?
  error.message :
  "";
  if (!message) return false;
  return (
    /controller is already closed/i.test(message) ||
    /request_signal_aborted/i.test(message) ||
    /client disconnected/i.test(message) ||
    /operation was aborted/i.test(message));

}