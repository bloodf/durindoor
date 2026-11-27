# PR #2627 unresolved-thread investigation

Reviewed source: `e6aed9ddb640135b55664ebb5244e735ebf27620`.
PR: https://github.com/bloodf/durindoor/pull/2627.
GitHub reported that exact head and eight unresolved threads on 2026-11-27.
No conversation was resolved or replied to, and no PR metadata or branch was changed.
This report and candidate fixes live on `scratch/upstream-review-e6aed9d`, based directly on the reviewed commit.

All line numbers in the following dispositions refer to the reviewed commit, **not** this candidate.
An outdated GitHub anchor was not treated as evidence of a fix: the current source was checked.

## Proposed dispositions

1. **`PRRT_kwDOTM9Pps68ZzbH` — publish batch limits as MDX. Already addressed; propose resolve after maintainer confirmation.**
   `docs/configuration.md` does not exist at the reviewed head. `docs/reference/environment.mdx:158–162` contains the batch limits and proxy prerequisite.
   `website/source.config.mjs:8–10` publishes `../docs` using `**/*.mdx`.
   No candidate change needed. The duplicate batch section at environment.mdx:361 is separate issue #2691 and remains outside this patch.

2. **`PRRT_kwDOTM9Pps68ZzbK` — complete tool JSON plus `[DONE]` without `finish_reason`. Intentional behavior; missing regression added here. Propose resolve only after this regression is accepted.**
   `open-sse/utils/streamTerminal.js:118–150` tracks completion for every seen OpenAI choice; `[DONE]` fails when a choice has no finish reason.
   `open-sse/utils/stream.js:2109–2125` uses that upstream outcome to reject buffered Claude tool calls with a retryable `overloaded_error`.
   Parsing the arguments as valid JSON cannot establish that the upstream turn finished; releasing the buffer would authorize a tool call from a potentially truncated turn.
   Text-only sentinel compatibility is deliberately different and already covered in `tests/unit/port9r-3860-anthropic-incomplete-terminal.test.js`.
   The candidate adds two end-to-end fixture cases to that file: identical complete JSON with and without a `tool_calls` finish chunk before `[DONE]`.
   Without it, assertions require exactly one final error, no input JSON delta, no tool-use stop reason, no message_stop, persisted error status, and no success callback.
   With it, the tool JSON is released, tool_use/message_stop arrive, persisted status is success, and the success callback fires once.
   A source comment records the distinction; runtime stream behavior is unchanged.

3. **`PRRT_kwDOTM9Pps68ZzbP` — reset disabled endpoints. Already addressed; propose resolve.**
   `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx:246,253,281,288` resets reachability and miss counters and increments the probe generation on disabled status reads.
   Explicit disable actions also reset at lines 408 and 618. Probe generations fence stale completions.
   `tests/unit/endpoint-stale-probe-2627.test.js` exercises both Cloudflare and Tailscale: disable/reset, re-enable, late completions, URL changes and miss thresholds (13 cases).
   The endpoint polling and streak suites also pass. No candidate endpoint change needed.

4. **`PRRT_kwDOTM9Pps68ZzbW` — stale model-probe errors. Partially valid; candidate fixes context retirement. Propose keep open until this fix is accepted.**
   At `src/app/(dashboard)/dashboard/providers/[id]/hooks/useProviderDetail.js:104–105`, transient errors are retained and all are formatted unconditionally.
   The only updates are lines 661 and 666; there is no retirement on provider, active probe connection or model-inventory changes. A failure can therefore remain after its row/account is gone.
   The bulk-pass allegation does **not** reproduce for “Test & Disable Failed Models”: lines 691–693 call `runModelTest`, whose successful completion at 661 removes the same model/connection error.
   Clearing the separate bulk error at 686 is not responsible for clearing individual errors.
   Compatible/passthrough model sections own separate local result state; provider-connection tests are not model probes and must not clear model failures.
   The candidate extracts `useModelProbeErrors`, scoped to the provider alias, first active probe connection and model inventory (registry, synced/free, custom and legacy-alias rows).
   Context changes retire errors; model removal prunes the corresponding error. Completion callbacks from retired contexts or removed models are ignored.
   Same-context inventory refreshes preserve unrelated failures; individual and bulk successes still clear only their own entry.
   `tests/unit/model-probe-error-context.test.js` mounts the real hook and covers these transitions, bulk success through the actual bulk helper, and navigating away/back before an old completion.
   This changes transient banner errors only; persisted model-test history and row-status storage are outside the patch.

5. **`PRRT_kwDOTM9Pps68Zzbd` — Cursor declaration between imports. Already addressed; propose resolve.**
   `open-sse/executors/cursor.js:43` is the final import (`crypto`); the estimate helper starts at line 47, below all imports.
   No candidate change needed.

6. **`PRRT_kwDOTM9Pps68aGHa` — operator limits nested under Host process. Already addressed; propose resolve.**
   `docs/reference/environment.mdx:158` and the duplicate at 361 both use `## OpenAI batch input limits`.
   Neither is a `###` subsection under `## Host process` (line 346). The canonical section sits beside runtime settings.
   No candidate change needed; duplicate removal remains #2691.

7. **`PRRT_kwDOTM9Pps68jbqK` — Cursor client margin on Claude non-streaming and Responses streaming. Already addressed; propose resolve.**
   `open-sse/handlers/chatCore/nonStreamingHandler.js:907–911` adds the margin once for estimated Claude message usage.
   `open-sse/utils/stream.js:886–903` projects estimated usage into Responses terminal events; call sites include lines 911,1689,2086,2147.
   Accounting remains raw. Provider-reported usage stays unpadded on these routes.
   Existing `tests/unit/cursor-margin-routes-2615.test.js` covers both requested paths, other Claude/Responses modes, total_tokens and provider-reported controls (7 cases).
   `cursor-raw-usage-2615.test.js` also checks raw accounting versus client margins (2 cases). Both pass at the exact reviewed head.
   No candidate accounting change needed.

8. **`PRRT_kwDOTM9Pps68jbqR` — build-time proxy body cap. Already addressed in the canonical section; propose resolve.**
   `docs/reference/environment.mdx:162` explicitly documents the default 128mb cap, build-time reading, rebuilding, and setting it above MAX_BATCH_BYTES plus 1 MiB for uploads above about 127 MiB.
   `next.config.mjs:10,43` reads and applies `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` at build/config time.
   The outdated duplicate at environment.mdx:363 lacks this note, but the canonical operator section already contains it. Consolidation remains #2691.
   This was source/doc verification, not a live oversized upload or a production build. No candidate change needed.

## Validation and limits

Dependencies were installed with frozen lockfiles for root, CLI, tests and website before candidate execution.
Each subsequent candidate/test process used `/tmp/durin-private-run.py`: a fresh mode-0700 directory with separate HOME, DATA_DIR, cache and temporary directories, `env` built from a small allowlist (PATH, private paths, CI and LANG), and `timeout 295`.
No publisher/provider credentials were forwarded. No real-provider tests were selected and no production services were started. `~/.9router` was not accessed.
CodeGraph was attempted in the private environment but its CLI was unavailable; bounded source searches and exact-head `git show` were used instead.

The exact-head verification uses a fresh `git archive` of the reviewed SHA with only dependency directories linked from the scratch installation.
The nine existing focused files run there, separately from the candidate. The candidate runs those nine files plus the new hook suite.
All commands use explicit Vitest paths, `--maxWorkers=2`, and the tests package config by running from `tests/`.
Full local CI, builds, a new independent cross-family review and branch-policy conversation resolution remain requirements before integration; this investigation does not replace them.
The failure baseline is unchanged. No push, PR edit, review submission, merge, live provider call or production operation was performed.

Validation results:

- Exact reviewed head: **86/86 tests passed**, nine files, from the fresh archive.
- Candidate: **95/95 tests passed**, ten files, including seven hook tests and the two new terminal cases.
- Root `pnpm run lint`: passed (ESLint plus anti-slop); the new hook also passed `eslint --max-warnings=0` separately.
- `git diff --check`: passed. Baseline unchanged.

Candidate command, from `tests/` (the exact-head run omits the new hook file):

```sh
python3 /tmp/durin-private-run.py node node_modules/vitest/vitest.mjs run \
  unit/model-probe-error-context.test.js \
  unit/model-probe-errors.test.js \
  unit/port9r-3860-anthropic-incomplete-terminal.test.js \
  unit/cursor-margin-routes-2615.test.js \
  unit/cursor-raw-usage-2615.test.js \
  unit/endpoint-stale-probe-2627.test.js \
  unit/endpoint-probe-streak.test.js \
  unit/endpoint-probe-polling-2620.test.js \
  unit/stream-terminal-outcome.test.js \
  unit/port9r-bulk-disable-failed-models-1740.test.js \
  --maxWorkers=2 --reporter=json --outputFile=/tmp/durin-review-tests.json
```

Local JSON reports and logs are retained under `/tmp/durin-review-evidence/` with private permissions.
The scratch commit is the review artifact; its exact SHA is reported in the handoff, since a commit cannot include its own hash.
