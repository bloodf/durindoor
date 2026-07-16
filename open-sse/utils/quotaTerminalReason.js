/**
 * Terminal-reason classifier for quota settlement (port of the relay timeout
 * semantics in diegosouzapw/OmniRoute#7093).
 *
 * A relay-bound connect/stream timeout surfaces downstream as an AbortError
 * whose message (or cause message) still says "timeout". Checking the error
 * name first misclassifies those as client aborts; this helper checks timeout
 * evidence first so the quota lifecycle settles the correct reason.
 *
 * @param {unknown} error
 * @param {object} [options]
 * @param {AbortSignal | null} [options.providerSignal]
 * @param {string} [options.fallback] reason when neither timeout nor abort
 *   evidence is present (`"stream_error"` for post-response handling,
 *   `"transport_error"` for the pre-response transport catch).
 * @returns {"abort" | "timeout" | string}
 */
export function classifyQuotaTerminalReason(
  error,
  { providerSignal = null, fallback = "stream_error" } = {},
) {
  const timedOut = error?.name === "TimeoutError"
    || String(error?.message || "").toLowerCase().includes("timeout")
    || String(error?.cause?.message || "").toLowerCase().includes("timeout");
  if (timedOut) return "timeout";
  if (error?.name === "AbortError" || providerSignal?.aborted) return "abort";
  return fallback;
}
