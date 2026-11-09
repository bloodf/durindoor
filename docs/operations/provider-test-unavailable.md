# Temporary connection-test failures

Registry connection probes return `valid: false, unavailable: true` when the provider returns HTTP 5xx or the guarded network probe cannot complete. This means credential validity is unknown. The saved-connection test leaves the stored credential status and secrets unchanged. HTTP 401/403 remains an explicit rejection and follows the existing error persistence path. URL guard failures remain blocked errors.

The single-test and batch APIs preserve `unavailable`. Bulk and detail summaries count these results separately from failed credentials and show the provider error. A successful catalog fallback can still complete validation. Generic Claude and fallback HTTP errors no longer prove key validity merely because they are not 401/403. Existing provider-specific chat validation contracts are unchanged.

Unavailable is an observation of this probe, not proof of account identity, key ownership, operational readiness or permission to delete an account. Retry later. Existing selection, filtering, scoped deletion and cancellation rules still apply.

The add/edit validation API also preserves an explicit `unavailable: true` from registry probes when a network failure has no HTTP status. Both forms show Unavailable instead of Invalid. URL-guard rejections remain blocked failures, not provider outages.
