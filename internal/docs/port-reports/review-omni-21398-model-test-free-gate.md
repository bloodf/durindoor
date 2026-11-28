# Review: OmniRoute #21398 model-test free gate

Verdict: **inapplicable**. The gate this PR fixes is not present in DurinDoor, so the reported 403 cannot occur here. No defect in this candidate. Severity: none.

## Upstream state

- PR: https://github.com/cheaper-inference/OmniRoute/pull/21398
- Title: `fix(models): accept provider-qualified ids in the model-test free gate`
- State: **open**, not draft, not merged (read 2026-11-27, `updated_at` 2026-11-27T09:53:03Z).
- Base: `release/v3.8.55` at `9671192011beb2d7f83979f40be488c5da8772b9` (not `main`).
- Head: `amibamae/OmniRoute` branch `fix/models-test-qualified-free-gate` at `e4664a28abc6cb9cac679810343c1c0fa755ffaa`.
- Size: 3 files, +69 / -5.
  - `src/app/api/models/test/route.ts`: the `hidePaid` gate now calls `isFreeTestTarget(providerId, modelId)` instead of `providerHasFreeModels && isFreeModel(providerId, { id: modelId })`.
  - `src/shared/utils/freeModels.ts`: adds `stripProviderQualifier` and `isFreeTestTarget`.
  - `tests/unit/models-test-qualified-free-gate.test.ts`: new unit tests.
- Upstream claim: with `hidePaidModels` on, Test on a qualified id such as `horde/google/gemma-4-31b` returns `403 Paid model blocked while hidePaidModels is enabled`. Taken from the PR body and diff; not reproduced here.

## DurinDoor comparison

Compared at `origin/main` (`29490b783e83`) and at the frozen train head `HEAD` (`d27f288cb5`, `orq/tp3r51/omni-review-21398-a1`). Both were read from Git objects. The three in-scope paths are identical between the two refs.

| Upstream path | DurinDoor equivalent | Result |
|---|---|---|
| `src/app/api/models/test/route.ts` | `src/app/api/models/test/route.js` (blob `a7a36ebf6bf1`, same at both refs) | No `hidePaid` read and no free predicate. Lines 8-31 parse `model`/`connectionId` and call `pingModelByKind` (line 26). |
| `src/shared/utils/freeModels.ts` | absent on both refs | Free predicates live in `open-sse/config/freeModelCatalog.js` (`providerHasFreeModels`, `isFreeModel`) and `open-sse/providers/pricing.js` (`isPaidModel`, lines 113-138), which the test route does not import. |
| `providers/[id]/test-message/route.ts` (the qualifier-strip reference) | absent on both refs | No second route to disagree with. |
| `src/app/api/models/test/batch/route.js` | same file, origin/main | Operator check only (lines 22-31). No paid gate. |

Negative evidence:

- `git grep 'Paid model blocked'` finds nothing in either ref's source or tests.
- `git log origin/main -S'Paid model blocked'` returns 0 commits. The gate never existed in DurinDoor history.
- `git log origin/main -S'isFreeTestTarget'` returns 0 commits.

## Scope and documentation

- `docs/guides/models-and-aliases.mdx:73` scopes **Hide paid models** to discovery and routing: "removes paid rows and combos with no visible members." It does not mention Test.
- `docs/reference/management-api.mdx:119` documents `POST /api/models/test` as "Ping one model by kind." It states no paid restriction.

So DurinDoor's test route ignores `hidePaidModels` by design, as documented. The upstream test-route gate is a separate upstream feature that DurinDoor has not ported.

## Overlap check

- The full-parity refresh (`internal/docs/port-reports/2026-11-27-full-parity-refresh.md`, row O0020) lists #21398 as "Unrecorded at this head; review required". This report is the disposition for that row.
- No sync-lane item claims #21398. The sync lane's items (#21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433, 9router #5884 and #5904) were checked and none overlaps. Nothing was modified or claimed.
- Adjacent, not overlapping: open issue #2614 ("Keep concurrent model test errors visible") concerns per-model error attribution in the dashboard, not the free gate. Not claimed here.

## Uncertainty

- Verdict is from static reading of Git objects and the upstream diff. Nothing was executed; no dependencies were installed and no live provider, service or credential was used.
- The upstream 403 trace was taken from the diff and PR body, not reproduced.
- If maintainers want upstream's test-route paid gate for parity, that is a separate product decision and a separate port. In that case the qualified-id handling from #21398 would be needed from the start.
