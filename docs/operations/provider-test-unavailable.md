# Temporary connection-test failures

Registry connection probes return `valid: false, unavailable: true` when the provider returns HTTP 5xx or the guarded network probe cannot complete. This means credential validity is unknown. The saved-connection test leaves the stored credential status and secrets unchanged. HTTP 401/403 remains an explicit rejection and follows the existing error persistence path. URL guard failures remain blocked errors.

The single-test and batch APIs preserve `unavailable`. Bulk and detail summaries count these results separately from failed credentials and show the provider error. A successful catalog fallback can still complete validation. Generic Claude and fallback HTTP errors no longer prove key validity merely because they are not 401/403. Existing provider-specific chat validation contracts are unchanged.

Unavailable is an observation of this probe, not proof of account identity, key ownership, operational readiness or permission to delete an account. Retry later. Existing selection, filtering, scoped deletion and cancellation rules still apply.

The add/edit credential check also preserves explicit registry `unavailable === true`, including network failures with `status: null`, and HTTP 5xx. Both forms display a neutral "Unavailable" result. A null status alone does not imply unavailability; blocked and unsupported probes retain their existing outcomes. HTTP 401/403 still displays "Invalid". Saving behavior is unchanged.

Save rechecks add credentials before persisting them. Unavailable or rejected add credentials can be saved with status `unknown`; a successful check saves `active`. Editing a credential after an unavailable or rejected check preserves the existing saved status and error. A successful edit check clears the previous error and saves `active`. The neutral Unavailable badge does not block Save or assert credential validity.

Form consumers share the same strict boolean outcome helper, including the connections-card add flow. A truthy non-boolean `unavailable` value is not outage evidence. Network probes explicitly mark unavailability; blocked URL probes with null status remain blocked.

## Adding media credentials

The **Check** action on add/edit credential forms never submits a media inference
request. deAPI uses its authenticated current-key read, Deepgram reads the key's
projects, and ElevenLabs reads user information. HuggingFace's token identity
check and Fal's existing model read remain available. These checks do not prove
that the key has permission or credit for every generation model.

For the new media account reads, HTTP 401/403 means the check was rejected.
HTTP 429/5xx, redirects, network errors and deadlines show **Unavailable** rather
than **Valid** or **Invalid**. Retry later; an outage is not evidence of a bad key.
Fal retains its existing explicit “Unable to verify” error contract for transient
HTTP failures.

Other media-only providers without an implemented documented authenticated read
show **Skipped — unverified**. You can save the credential, but saving does not
verify it. New connections and skipped credential replacements use an unknown
test status, not active. No inference or job is submitted to check such keys.
Generation and request adapters are unchanged; actual use can still fail.
