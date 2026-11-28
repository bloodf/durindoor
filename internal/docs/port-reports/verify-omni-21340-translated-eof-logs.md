# Verification: OmniRoute #21340 translated EOF text in call logs

**Verdict: confirmed, low severity, and narrowed.** When the upstream target is **Claude** and the final SSE text frame arrives unterminated (no trailing blank line), the text reaches the client wire but is missing from the completion snapshot passed to `onStreamComplete`, which feeds call logs and request detail. It is also left out of the fallback usage estimate. The candidate's **Responses** sub-claim is dropped as an EOF effect: Responses text is absent from the snapshot even when every frame is terminated.

Reproduced offline on both reference revisions, with no live providers, secrets, services, or gateway.

## Refs and corrections to the candidate report

- Report commit: `ceebd401d1813cdb36664cb80444f038b748a16a` ("docs: record OmniRoute 21340 translated EOF gap"). The brief's `ceedb401d1` does not resolve.
- main: `29490b783e83176d4d6a4162f76ee3dc79db66ea` (`fix(usage): reconcile observed quotas and cache creation aliases (#2690)`).
- train: `32a783d76d45d90bf0517015442f43fadd96106c` is a **commit**, not a tree (`merge: include #2683 in train/2`). Its tree is `fd449b3cefa538d912c3b51dee0ed774ede580e6`. Both were exported with `git archive`.
- `open-sse/utils/stream.js` is **not** byte-identical between main (`5822fc2f`) and train (`44be9765`). The diff has two hunks: an added `applyStreamQuirks` import, and the quirk block near line 1090 moved into `streamQuirks.js`. The EOF path and completion collector are identical at both refs, so the candidate's behavioral claim holds for the region it cites. Its wording "identical at all three refs" is true only for that region.
- Line citations at main: the EOF `recordCompletionData(parsed, { trackUsage: false, content: true })` call is at 2048 (report: 2047–2050), translation at 2053, collector 561–631 (appends at 615 and 629), `getAccumulatedCompletion` 536–540. All match.
- Mechanism gap: the candidate says Claude `delta.text` is never collected. That holds for the EOF collector, but complete frames are accumulated by a separate per-frame block (main 1551–1593, which reads `parsed.delta?.text` for Claude). The EOF tail never runs that block, which is the actual reason the tail text is lost.

## Source trace (main; train identical in this region)

1. The EOF tail runs only in TRANSLATE mode. The PASSTHROUGH branch of `flush` opens at 1807 and returns before the TRANSLATE tail at 2000.
2. Line 2048 calls `recordCompletionData(..., { content: true })`. Per `561–631`, it appends only OpenAI `choices[].delta` text and Gemini parts. Claude `delta.text` is read only for summary bookkeeping, and Responses `delta` strings are not read at all.
3. Lines 2053 onward translate the tail and enqueue it to the wire. Nothing appends the translated text to the snapshot, and `totalContentLength` is not incremented for it.

## Reproduction

Setup, identical for both trees:

```bash
mkdir -p /var/tmp/vo21340/main /var/tmp/vo21340/train
git archive 29490b783e83176d4d6a4162f76ee3dc79db66ea | tar -x -C /var/tmp/vo21340/main
git archive 32a783d76d45d90bf0517015442f43fadd96106c | tar -x -C /var/tmp/vo21340/train
# in each export: pnpm install --frozen-lockfile --prefer-offline --ignore-scripts   (~3–7 s, from store)
```

Runs use a credential-stripped env with private directories under `/var/tmp`, never `~/.9router`:

```bash
env -i PATH="$PATH" HOME=/var/tmp/vo21340/env-<t>/home DATA_DIR=/var/tmp/vo21340/env-<t>/data \
  TMPDIR=/var/tmp/vo21340/env-<t>/tmp VO_TREE=/var/tmp/vo21340/<t> \
  timeout 240 node --no-warnings --import file:///var/tmp/vo21340/harness/register.mjs run.mjs
```

`harness/hooks.mjs` maps `@/…` to `src/`. It stubs `@/lib/usageDb.js` as a no-op, since the real module needs the SQLite DB. Harness scripts: `/var/tmp/vo21340/harness/run.mjs` (`createSSEStream`, translate mode) and `/var/tmp/vo21340/harness/run-logger.mjs` (`createSSETransformStreamWithLogger`, the production wrapper that call logs use). Unterminated input: `data: {…"text":"Hello"}\n\n` followed by `data: {…"text":" world"}` with no terminator.

Results. The output was identical on main and train.

| Scenario | `" world"` on wire | Snapshot `content` |
|---|---|---|
| Claude target, unterminated final frame (`run.mjs`) | 1 | `"Hello"` |
| Claude target, terminated control | 1 | `"Hello world"` |
| Claude target, unterminated, production wrapper (`run-logger.mjs`) | 1 | `"Hello"` |
| Claude target, terminated, production wrapper | 1 | `"Hello world"` |
| Responses target, unterminated | 1 | `""` |
| Responses target, terminated control | 1 | `""` |
| OpenAI target, unterminated (same-format collector control) | 1 | `"Hello world"` |

Fallback usage through the production wrapper, when upstream sends no usage (both trees): unterminated `completion_tokens: 1` versus `2` in the terminated control, both `estimated: true`.

## Interpretation

- **Claude target: confirmed.** The defect is EOF-specific: the terminated control records the same text. Wire output is complete, so this is a call-log and accounting defect, not a client-visible one.
- **Responses target: dropped as an EOF effect.** The snapshot is empty even with terminated frames. Complete frames never record Responses text into `content` either, because the per-frame block reads `parsed.delta?.text`, which is a plain string for Responses. This is a broader gap that the candidate's EOF framing does not explain. I did not test a stream ending in a `response.completed` event carrying output, so whether real Responses call-log detail is filled from another field (`hasSnapshotOutput` or the output backfill) is uncertain.
- **Existing coverage:** `tests/unit/portor-stream-tail-20279.test.js:35–38` ("records content in an unterminated translated tail") covers only an OpenAI upstream (`createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, …)`). It does not exercise a Claude upstream tail. The #20279 port note (`1073-nov22-port-20279.md`) describing unterminated tail content therefore holds only for OpenAI upstreams, which supports the candidate's "narrower" framing.

## Severity

**Low.** Impact: call-log and request-detail content (and `onComplete` `responseBody`) omit the final text fragment when the upstream's last frame lacks a trailing blank line and the target is Claude. Secondary: the fallback usage estimate undercounts in that case, but only when upstream reports no usage. Triggering requires a truncated or unterminated final frame. I did not check this against any live provider and make no live-acceptance claim.

## Ownership and overlap

- #2266 (combo routing) and #2289 (compression) are not related to this path. The auth lane is unaffected.
- #2699 (OPEN, bug): "Project usage consistently at bare Responses EOF" touches the same translate-mode EOF tail, but concerns usage projection for Responses, not snapshot content. A fix here would touch that tail, so coordinate with the sync-lane owner of usage files before changing it.
- `gh issue list --search` (translated EOF, EOF completion, 21340, call log content) found no open issue for the translated completion-snapshot gap.
- Parity ledger row O0068 exists at `internal/docs/port-reports/2026-11-27-full-parity-refresh.md:1736` with status "Unrecorded at this head; review required", matching the candidate.

## Dropped or uncertain

- **Dropped:** the Responses-target EOF attribution.
- **Uncertain:** whether real Responses call logs get their text from another field; whether live upstreams emit unterminated final frames at all.
- **Not done:** no product edits, no fix, no issues, no PR changes, no live providers.
