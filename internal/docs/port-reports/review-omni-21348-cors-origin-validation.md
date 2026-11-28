# Review: OmniRoute #21348 — validate the CORS allowed origins list (KEA-9580)

Static review only. No install, service, provider, credential, gateway or
candidate code was executed. Git objects were read with `git show` / `git
grep` / `git ls-tree`.

## Inputs

| Item | Value |
|---|---|
| Upstream PR | `cheaper-inference/OmniRoute#21348`, `fix(settings): validate the CORS allowed origins list (KEA-9580)` |
| Upstream state | open, not draft, not merged; updated `2026-11-26T19:17:40Z` (read via `gh api`, read-only) |
| Upstream base | `release/v3.8.55` @ `0a1fe5ef8f5cbc5496200314bcec11aba9d545f0` |
| Upstream head | `fix/kea-9580-cors-origins-validation` @ `d4d974f651bb85eb17bcda8979949bb5785e9ad3` |
| Upstream size | 8 files, +228 / −4 |
| DurinDoor `origin/main` | `29490b783e83176d4d6a4162f76ee3dc79db66ea` |
| Frozen train tree | `32a783d76d45d90bf0517015442f43fadd96106c` |

Upstream files: `changelog.d/fixes/kea-9580-cors-origins-validation.md`;
`src/app/(dashboard)/dashboard/settings/components/SecurityTab.tsx`;
`src/i18n/messages/en.json`; new `src/shared/validation/corsOrigins.ts`;
`src/shared/validation/settingsSchemas.ts`; new
`tests/unit/cors-origins-validation.test.ts`; modified
`tests/unit/security-settings-operator.test.ts`; new
`tests/unit/ui/security-cors-origins.test.tsx`. Full diff kept at
`/home/stormtrooper/.cache/agent-tmp/claude-1000/-home-stormtrooper--local-share-t3-stormtrooper-worktrees-durindoor-network-orq-tp3r51-omni-review--f104b9b599c215dd/7ba61df2-737a-431f-818b-6dff5d1c36a8/scratchpad/pr21348.diff`.

What the upstream PR changes: it adds a validator to an **existing**
`corsOrigins` setting (base schema `z.string().max(500)`), wires that
validator into the Security tab's CORS field, and adds an i18n string. Its
behavior is entirely validation of a stored value on an OmniRoute setting
surface.

## Prior dispositions and claims checked

- `internal/docs/port-reports/2026-11-27-full-parity-refresh.md:1730` lists
  `O0062` / #21348 at this head as "Unrecorded at this head; review required".
  This report is that review.
- `1073-june2-row-dispositions.md`, `1073-february-runtime-source-3.md`: the
  only other CORS-adjacent rows concern #79 (audio routes) and unrelated
  9router PRs. Neither mentions #21348 or KEA-9580.
- `omni-review-*.md` (local worktree): no #21348 or CORS-origin entry.
- Active lane claims (auth, sync and the listed #2034/#1241/#1234/#2266/#2289
  items): #21348 is not in any listed lane. Nothing is claimed or staged
  for this candidate, so there is no overlap to report.

## Evidence in DurinDoor

1. **The setting does not exist.** Over `origin/main` (excluding port
   reports), `git grep` for `corsOrigins`, `CORS_ALLOW_ALL` and `CORS_ORIGINS`
   returns nothing. The eight upstream target paths
   (`src/shared/validation/*`, `SecurityTab.tsx`, `en.json` key, the three test
   files, the changelog fragment) are absent from both `origin/main` and the
   frozen train tree. `src/shared/validation/` has no files in either tree.
2. **CORS is a fixed wildcard, not a configurable list.**
   `src/lib/http/cors.js:6` returns `"Access-Control-Allow-Origin": "*"` from
   `corsHeaders()`. `src/app/api/health/route.js`, `src/app/api/livez/route.js`,
   `src/app/api/tags/route.js` and the `src/app/api/v1/**` routes all build on
   it or repeat `*`. The public docs describe wildcard CORS for public leaves
   (`internal/docs/product/reference/provider-plugin-manifest.mdx`, around
   line 10 of that file). No doc describes an operator-set origin list.
3. **Unknown settings keys are rejected before storage.** The PATCH handler
   `src/app/api/settings/route.js:172` calls
   `validateSettingsPatch(body)` at `:201`. That function
   (`src/lib/settings/settingsSchema.js:330-335`) pushes any key without a
   `SETTINGS_SCHEMA` rule into `invalid`. The handler then returns
   `400 {"error":"Invalid settings","keys":[...]}` (`route.js:203`). A PATCH
   carrying `corsOrigins` therefore returns 400 and never reaches
   `updateSettings` (`src/lib/db/repos/settingsRepo.js:158`), so nothing is
   written.
4. **Frozen train tree is identical on these paths.** `git diff --stat
   origin/main 32a783d7 -- src/lib/settings src/lib/http src/app/api/settings
   'src/app/(dashboard)/dashboard/settings/components'` is empty. In the train
   tree `validateSettingsPatch` is at `settingsSchema.js:330/334`,
   the 400 at `route.js:201/203`, and `Allow-Origin: "*"` at `cors.js:6`.

## Behavior mapping

| Upstream behavior (#21348) | DurinDoor state | Consequence |
|---|---|---|
| Security tab shows an inline error for an invalid CORS list and does not save on blur | No Security tab CORS field; no `corsOrigins` UI | No user-visible defect to fix |
| `PATCH /api/settings` returns 400 for `"<b>x</b> 😀, http://"` and keeps the saved list | Any `corsOrigins` key returns 400 `Invalid settings` via `validateSettingsPatch` (`settingsSchema.js:334`) | Outcome already matches for the only input the PR's test checks, by a different path (unknown-key rejection, not validation) |
| Valid list saves; empty clears | Unknown key is refused, so it cannot be saved or cleared | Not implemented; not a regression because no runtime reader exists |
| Runtime CORS allow-list (implied by the setting's purpose) | Absent: `cors.js:6` is always `*` | The upstream runtime consumer is not in this diff and has no DurinDoor counterpart |

## Verdict

**Intentional / inapplicable.** The validator targets a setting DurinDoor
does not expose. Its only observable result on DurinDoor is the generic
unknown-key 400, which already protects the same surface. No behavior is
missing for the ticket's input, and no UI exists to show or save invalid
text.

- Severity: none. No defect is present for the scenarios in the PR's tests.
- Port recommendation: **do not port**. A faithful port would add a new,
  operator-configurable CORS origin feature with a runtime consumer, which is a
  feature and security-policy decision, not parity. Its scope would also cover
  every `corsHeaders()` caller, not only the settings route.
- Not claimed: no active claim or staged work overlaps this candidate.

Not verified: I did not run the upstream unit tests or a PATCH request. The
trace above is static and rests on the cited lines.
