# Image generation: health after a refresh retry

After a 401 or 403, the image core may refresh the credentials and retry. Account health must describe the retried dispatch, not the snapshot taken before the refresh. The refresh rewrites the stored row, so that snapshot's fingerprint and `dispatchedAt` no longer match and the fence drops the write.

`handleImageGenerationCore` calls `onUpstreamDispatch(sent, dispatchedAt)` each time the provider answers a dispatch: the first send, the retry after a refresh, and the fallback-body resend. `sent` is a copy of the credentials made before the send. Transport errors are not reported. Executor errors tagged with an HTTP status are reported. `src/sse/handlers/imageGeneration.js` turns each report into a frozen `{ usedCredential, credentialFingerprint, dispatchedAt }`. The streamed failure write, the buffered failure write in `runMediaAccounts`, and the success clear all use the latest report.

A secret refreshed during the attempt is fingerprinted directly instead of through the stale `_connection` copy. The write applies only while the row stores that secret. If a concurrent refresh wins the guarded commit, or the row is changed to another account's credential, the outcome is dropped instead of landing on that credential. An unchanged secret keeps the `credentialDispatchSnapshot` rule, so a derived token that is not stored stays fail-open.

Executors that refresh inside `executeViaExecutor` still report the credentials sent at entry.

Test: `tests/unit/image-refresh-dispatch-health.test.js`.
