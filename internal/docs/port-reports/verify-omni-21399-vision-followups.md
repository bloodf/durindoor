# Verification: OmniRoute #21399 vision follow-ups candidate

**Verdict: the candidate's central defect is not confirmed.** Its claims that a text-only fallback receives the image, or triggers the caption bridge, are contradicted by the code and by a local offline run. The `auto/vision` route it describes does not exist in DurinDoor. One narrower behavior is real: on a text follow-up after an image, vision routing does not apply and an earlier image is replaced by a placeholder. That matches the documented current-turn-only contract, so it is an absent upstream follow-up feature at low severity, not an existing defect.

Candidate reviewed: `541074a6c70d983738075d8f04929a830979ad59` (`internal/docs/port-reports/review-omni-21399-vision-followups.md`).

## Refs

| Ref | Value checked |
| --- | --- |
| DurinDoor main | `29490b783e83176d4d6a4162f76ee3dc79db66ea` (commit; tree `ba241eb7e1ff2a3840359ad583320c5645090c69`) |
| Frozen train | `32a783d76d45d90bf0517015442f43fadd96106c` is a **commit**, not a tree. Its tree is `fd449b3cefa538d912c3b51dee0ed774ede580e6`. |

The brief names `32a783d7` as a tree. It is a commit whose tree is `fd449b3c`. Both are used below as commits.

The three files the candidate traces are byte-identical between main and the train, and identical to the current worktree HEAD (`c8a757e8c0`):

```
$ git diff --quiet 29490b78 32a783d7 -- open-sse/services/model.js  -> identical
$ git diff --quiet 29490b78 32a783d7 -- src/sse/handlers/chat/combo.js -> identical
$ git diff --quiet 29490b78 32a783d7 -- open-sse/services/combo.js -> identical
```

The candidate's upstream file list uses `.ts` paths. DurinDoor has `.js` files at these paths, and none of the upstream `.ts` paths exist locally. Upstream PR metadata was **not verified**: `gh pr view 21399 --repo cheaper-inference/OmniRoute --json ...` printed no metadata, only a `gh event listen` hint, so the candidate's upstream SHAs stand unconfirmed.

## Findings

### 1. Text-only fallback receives the image, or triggers the caption bridge: DROPPED

The candidate says a retained text-only member gets the same image body and may trigger the caption bridge. Both are contradicted:

- **Strip pass before translation.** `open-sse/handlers/chatCore.js:729-743` calls `stripUnsupportedModalities(body, sourceFormat, caps)` for any non-passthrough request, where `caps` is `effectiveModelCapabilities` (`chatCore.js:529`). Per `open-sse/providers/capabilities.js`, `DEFAULT_CAPABILITIES` sets `vision: false` as the "safe floor (always returned)", so unknown models are stripped too.
- **Offline run.** Node v24.22.3, private `HOME`/`DATA_DIR`/`TMPDIR` under `/var/tmp/verify-omni-21399`, `env -i` with a clean PATH, extracted from main with `git archive`:

```
$ node scratch/strip-check.mjs
CURRENT-TURN caps={"vision":false} changed=true [{"type":"text","text":"what is this?"},{"type":"text","text":"[image omitted: model has no vision support]"}]
CURRENT-TURN caps={} changed=false [... image_url passes through ...]
CURRENT-TURN caps={"vision":true} changed=false [... image_url passes through ...]
FOLLOWUP caps={vision:false} changed=true [{"type":"text","text":"describe"},{"type":"text","text":"[Previous image omitted from context.]"}]
```

The `caps={}` row is not reachable in practice, since `getCapabilitiesForModel` always merges over the `vision: false` floor. A text-only member therefore receives a placeholder, not the image.

- **Caption bridge disabled.** Every combo member attempt passes `allowVisionBridge: false` (`src/sse/handlers/chat/combo.js:302-320`, also `:281` and `:319`). Only the direct non-combo path (`:365`) passes `true`. `src/sse/handlers/chat/singleModel/admission.js:64` returns `proceed()` when `!ctx.allowVisionBridge`. The caption bridge therefore cannot run on fallback, so the "stale or generalized caption" failure mode does not arise on this path.

Documented contract matches the code: `docs/features/combos.mdx:166` says "Unsupported media fields are stripped before translation."

Severity: none for this claim. It is false.

### 2. A local `auto/vision` route ranks native-vision candidates first: DROPPED (absent upstream feature)

- `open-sse/services/autoComboFamilies.js:16-25`: `MODEL_FAMILIES = ["glm","minimax","mimo","zai","gemma","llama","gemini"]`. `vision` is not a family.
- `git grep -n "auto/vision" 29490b78 -- ':!tests' ':!internal'` returns nothing. The only reference anywhere is the passthrough test at `tests/unit/vision-bridge.test.js:108`.
- The candidate's "`auto/vision` combo path" at `src/sse/handlers/chat/combo.js:302-320` is the generic combo call used for every non-fusion combo, not an `auto/vision` route.
- The vision reorder applies to any combo because `handleComboChat` defaults `autoSwitch = true` (`open-sse/services/combo.js:1525`), and the generic call at `src/sse/handlers/chat/combo.js:302-320` does not override it.

So the mechanism the candidate describes is real, but it is a property of all auto-switch combos, not of an `auto/vision` feature. The `auto/vision` naming is an upstream construct that DurinDoor does not have.

Severity: none as a defect. Upstream `auto/vision` is an absent optional feature.

### 3. Text follow-up after an image: vision preference and image detail are lost: CONFIRMED behavior, low severity, documented

Trace:

1. `open-sse/services/combo.js:559-616`: `detectRequiredCapabilities` scans modalities only on the current user turn ("Modalities (vision/audioInput/pdf) are scanned only on the current user turn"). On a text follow-up, `required` contains no `vision`.
2. `open-sse/services/combo.js:1603-1612`: `reorderByCapabilities` runs only when `required.size > 0`. A follow-up therefore keeps the rotation order, so a text-only member can be first.
3. `open-sse/services/combo.js:1715-1745`: the fallback loop dispatches the original body to members in that order.
4. `chatCore.js:729-743` (verified offline above): the earlier image becomes `[Previous image omitted from context.]` on the text-only member, so the model answers the follow-up without the image.

The reorder unit check I attempted (`detectRequiredCapabilities` / `reorderByCapabilities` in `open-sse/services/combo.js`) did not run. Its import graph reaches `src/lib/usage/receipt.js`, which the `git archive` extract did not include, so step 1-2 rests on source reading, not execution.

This is documented. `docs/features/combos.mdx:166` says a request carrying images "on the current user turn prefers a member that advertises that modality." The upstream title "preserve native images on auto/vision follow-ups" describes a feature DurinDoor does not have.

Severity: low. This is an absent upstream follow-up enhancement, not an existing defect against DurinDoor's documented contract. Whether the product should preserve history images in routing is a product decision.

## Ownership and existing issues

- Searched open and closed issues with `gh issue list --search "vision follow-up OR auto-switch vision OR image follow"`. No issue matched this behavior.
- The brief lists #2266 and #2289 as auth-owned. They are not. `gh issue view` returned:
  - #2266 (OPEN): "[low] Combo routing: 2348-line combo.js, inconsistent runtime-state convention, O(n) affinity prune per request"
  - #2289 (OPEN): "[medium] Compression split across three stages and config sources; headroom stack engine always assumes OpenAI; dead compact.js"
  
  #2266 is the nearest owner for `open-sse/services/combo.js` routing. Neither is about auth or vision.
- Refresh ledger row O0019 (`internal/docs/port-reports/2026-11-27-full-parity-refresh.md:1687`) lists #21399 as "Unrecorded at this head; review required." No prior verdict.
- Sync-lane usage and shared refresh files are not touched by this path.

## Commands and outputs (summary)

```
$ git show 541074a6c70d983738075d8f04929a830979ad59:internal/docs/port-reports/review-omni-21399-vision-followups.md  -> candidate read
$ git rev-parse 29490b783e83176d4d6a4162f76ee3dc79db66ea^{commit}  -> 29490b783e83176d4d6a4162f76ee3dc79db66ea
$ git rev-parse 32a783d76d45d90bf0517015442f43fadd96106c^{tree}   -> fd449b3cefa538d912c3b51dee0ed774ede580e6
$ git cat-file -e <main>:src/sse/handlers/chat/combo.js  -> present (blob 69bcddf2)
$ node scratch/strip-check.mjs  -> see Finding 1
$ node scratch/reorder-check.mjs -> ERR_MODULE_NOT_FOUND (src/lib/usage/receipt.js); not executed
$ git grep -n "auto/vision" <main> -- ':!tests' ':!internal'  -> (no output)
$ git grep -c "auto/vision" <main> -- tests  -> tests/unit/vision-bridge.test.js:1
$ gh issue view 2266 / 2289  -> see Ownership
```

Note: a zsh expansion of `$M:path` in this session returned the commit hash instead of the blob. Lookups in this report use `"${M}:path"`.

## Sandbox

Offline run only, Node v24.22.3, under `/var/tmp/verify-omni-21399` (`home`, `data`, `tmp`, `src` from `git archive` of main, `scratch`). No `~/.9router`, no credentials, no network calls to providers, no dependency install, no gateway or services. One `Bash` command was denied by the sandbox and was not retried verbatim; a narrower variant ran.

## Not verified

- Upstream #21399 content, head SHA, and test expectations (no PR metadata returned).
- The reorder gating in Finding 3 by execution (source trace only).
- Any live-provider behavior.
