# 1073: A plain-text provider error reaches the combo fallback classifier

## Source

[OmniRoute #943](https://github.com/cheaper-inference/OmniRoute/pull/943), `fix: restore GitHub Copilot combo requests`, head `629a6936fab709cbc8bd6eb6a2dda8647dcf6d3f`, merged as `7dea0441ac5e6463d0df3817039a085cc8df1059` (first parent `34c41d5f3d`).

The merge touches three files: `open-sse/executors/github.ts` (Copilot token handling and TLS response materialization), `open-sse/services/combo.ts` (the error-classification repair), and one upstream test file. Only the combo error-classification repair is in scope here; the executor changes are provider auth and GitHub HTTP-client materialization and stay out.

Exact first-parent patch for the combo part (upstream `open-sse/services/combo.ts`, applied at two sites — `handleComboChat` and `handleRoundRobinCombo`):

```diff
-          const errorBody = await cloned.json();
-          errorText =
-            errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
-          retryAfter = errorBody?.retryAfter || null;
-        } catch {
-          try {
-            const text = await result.text();
-            if (text) errorText = text.substring(0, 500);
-          } catch {
-            /* Body consumed */
+          const text = await cloned.text();
+          if (text) {
+            errorText = text.substring(0, 500);
+            const errorBody = JSON.parse(text);
+            errorText =
+              errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
+            retryAfter = errorBody?.retryAfter || null;
+          }
+        } catch {
+          /* Clone parse failed */
```

Upstream behavior: the provider body is read as text and then parsed as JSON. A body that is not JSON keeps a 500-character plain-text message for the fallback classifier instead of being dropped; a JSON body still resolves the message through the same alias chain (`error.message` → `error` → `message`). Upstream also reads the body from the clone in both cases.

## Disposition: adapted (not a literal port)

DurinDoor has one combo fallback loop, not upstream's two: the round-robin strategy is a branch inside the same member loop (`open-sse/services/combo.js:1748`), so a single error-extraction site owns both strategies.

Existing equivalent, checked before editing:

- The pre-change site read `await result.clone().json()` and dropped the body entirely when the parse failed, so a non-JSON provider error was classified on the HTTP status text alone. No plain-text extraction existed anywhere in the combo path.
- `open-sse/services/modelFallback.js:119` and `open-sse/services/modelFallback.js:142` already read a clone's text, but they feed `isDeterministicPayloadError` in the per-model fallback chain, a different classifier. They are untouched.
- `open-sse/services/combo.js:1350` (`isBodyEmpty`) also reads a clone's text, for the successful-response path. It is untouched.

Local change (`open-sse/services/combo.js:1764`):

- The existing JSON read stays exactly as it was: same `clone().json()` call, same alias chain `errorBody?.error?.message || errorBody?.error || errorBody?.message`, same retry-after sources `errorBody?.retryAfter ?? errorBody?.error?.retry_after ?? null`.
- Only when that read fails is a second clone read as text, and a bounded (500 character) plain-text message is kept for the classifier. The read uses a clone, so the original response body stays readable for the direct-return paths (`return result` on a non-fallback failure, and the request-scoped `requestScopedResult` return).
- The plain-text message is bounded, so a large HTML or plain-text provider body cannot become the client-facing error message in full.

Why the second clone instead of replacing the JSON read with a text read: the repository's own combo tests drive the error path with response doubles that implement `clone()` and `json()` only, and the existing suite asserts on the number of awaited microtask ticks before the next member is invoked (`tests/unit/combo-patches.test.js:166`). Reading the body as text first changed that count and broke two existing assertions. Keeping the JSON read as the primary path leaves the JSON behavior, its tick count, and its error text byte-identical, and adds the plain-text read only where the JSON read failed.

### Local lifecycle events stay local

`isLocalStreamLifecycleError` (`open-sse/utils/streamLifecycle.js:16`) recognizes `request_signal_aborted`, "Client disconnected", "operation was aborted" and "controller is already closed" as locally generated abort markers. A provider body is upstream content, so the plain-text path classifies `result.statusText` for that check instead of the provider's own words. A provider that answers "Client disconnected" is a provider failure that may rotate to the next member, not a client-side abort that must short-circuit the combo with HTTP 499. The JSON path keeps its existing behavior: a structured provider message that repeats an abort marker still classifies as a local lifecycle event.

### Preserved

- JSON parsing, the message alias chain and its selection order.
- Retry-after sources: the JSON body's `retryAfter` / `error.retry_after`, and the `Retry-After` response header (which `comboRetryAfter` prefers over the body).
- Abort ownership: a client disconnect still returns the combo's 499 abort response through the unchanged `signal?.aborted` and `abortedResponse()` paths.
- Early client disconnect: `if (signal?.aborted) return abortedResponse();` at the top of the member loop is unchanged.
- Admitted-job handling: the `ACCEPTED_JOB_HEADER` check still returns the provider's response without trying other members, before any body read.
- Final response status: `getClientStatusFromError` and the 401 / missing-model remap are unchanged, and a plain-text body cannot trigger that remap (it requires a JSON `ModelError` envelope).
- Unrelated logging: no log line, warning or metric was added, removed or reworded.

### Not ported

- The upstream `open-sse/executors/github.ts` changes: Copilot token handling and GitHub TLS response materialization. They are provider auth and HTTP-client materialization, outside this port's scope.
- Upstream's replacement of the JSON read with a text read plus `JSON.parse`. The fork keeps its JSON read and adds the plain-text read as a fallback, so the JSON path is untouched.
- Upstream's `retryAfter = errorBody?.retryAfter || null`. The fork reads `errorBody?.retryAfter ?? errorBody?.error?.retry_after ?? null`, which keeps a second retry-after source and a `null` value; unchanged.
- Upstream's read of `result.text()` (the original response) in the fallback branch. The fork reads a clone, so the original body stays readable.

## Actual behavior

For a provider member that answers with a non-2xx status and a body that is not JSON:

- The fallback classifier (`checkFallbackError`, `open-sse/services/accountFallback.js:53`) now sees the provider's own message, so a plain-text body is classified like the same message delivered as JSON. A billing body ("credit balance is too low") rotates to the next member as terminal billing, a wrong-model body ("model not found") stops the rotation, a request-scoped 4xx is handed back as the member's own response, and a quota body keeps the rate-limit verdict.
- Without the change, the same failure was classified on the HTTP status text alone, so a plain-text billing or quota body fell through to the generic transient verdict and the client-facing message was the bare status.
- The final error message keeps the provider's reason instead of the bare status, bounded to 500 characters.

## Protection added

`tests/unit/omni-combo-nonjson-error-classification.test.js` runs offline with no network, no credentials and no provider traffic:

- A plain-text body and the same message delivered as JSON classify identically: the same member selection order, the same final status, and the same reason in the response body (400 billing, 400 wrong-model, 400 request-scoped, 429 quota).
- The plain-text reason reaches the final error message, and the kept message is bounded to 500 characters.
- The original plain-text body stays readable when the member error stays request-scoped.
- A plain-text provider body that repeats an abort marker is not reinterpreted as a local client abort: the combo still rotates to the next member instead of returning HTTP 499.
- The JSON message alias chain and its selection order are unchanged, and the JSON retry-after, nested JSON retry-after and response-header retry-after sources still produce the same `Retry-After` response.
- Combo alias resolution and member selection are unchanged: a mixed-case combo alias resolves to the canonical stored combo, the exactly-cased combo wins, and the case-insensitive alias resolves to the same members.

Verification commands and results:

- `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-combo-nonjson-error-classification.test.js` — 13 passed.
- The same file against the pre-change `open-sse/services/combo.js` — 4 failures (the plain-text parity cases, the final-message case and the bounded-message case), so the test detects the ported behavior.
- The same file with the local-lifecycle guard removed — 1 failure (the plain-text abort-marker case), so the guard is load-bearing.
- `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 <51 combo/fallback/lifecycle-scoped unit files>` — 51 files, 589 tests, all passed. The set covers every `unit/combo*.test.js`, `unit/account-fallback*.test.js`, `unit/port-5cdcddf5-combo-request-scoped-4xx.test.js`, `unit/omni-qoder-model-queue-scope.test.js`, `unit/omni-opencode-model-unavailable.test.js` and `unit/omniroute-websession-blocked.test.js`.
- `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 <133 abort/lifecycle/retry/error/stream unit files>` — 133 files, 1259 tests, all passed.

Verification limits: offline synthetic provider responses only (plain-text bodies, JSON bodies and their status codes). No live provider traffic, no paid API, no credential access, no browser, no Docker, no end-to-end run and no whole-suite run was performed. `tests/__baseline__/known-fails.txt` was not touched.
