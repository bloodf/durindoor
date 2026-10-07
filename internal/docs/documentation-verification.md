# Documentation rewrite verification

Date: 2026-10-07. Final source revision: `336fc08bf849d73eea415b82ae21a648d71171fe`. The later evidence-only commit adds this report without changing the tested website or examples.

## Scope and source review

73 public MDX pages were reviewed. 71 nongenerated chapters retain full implementation references under `internal/docs/product/`; the public root overview and generated provider catalog retain their separate ownership. Maintenance, porting, brand rules, prompts, and audit evidence are repository-only. Runtime image formats are copied to the site; Markdown and vector archives are excluded, with stale copies removed.

Independent source reviewer: `gpt-5.6-sol`. Corrected findings cover empty-value normalization before PostgreSQL selection, Compose cutover order, loopback versus remote HTTP credential checks, unknown-key admission when enforcement is off, cached image retrieval limitations, native realtime versus chat-facade audio, guarded initial-password examples, and the private realtime handoff. Public guides do not claim live vendor entitlement or paid inference proof.

## Executed checks

| Check | Command and tested revision | Outcome | Full local log |
| --- | --- | --- | --- |
| Documentation integrity | `node scripts/check-docs.mjs`, final source revision | Passed | Command output: `Documentation integrity checks passed.` |
| Generated provider catalog | `node scripts/gen-provider-catalog.mjs --check`, integrated source through `2bb3a6da3`; later edits only Docker secret generation and MITM recovery wording | Passed; no catalog edit | `/tmp/durindoor-docs-catalog-final.log` |
| Focused regression checks | `npx vitest run --config tests/vitest.config.js tests/unit/auth-jwt-secret-placeholder.test.js tests/unit/auth-placeholder-initial-password.test.js tests/unit/mitm-platform-privilege.test.js tests/unit/check-docs.test.js tests/unit/website-public-brand.test.js`, final source revision | 5 files, 60 tests passed | `/tmp/durindoor-docs-focused-final.log` |
| Root lint | `npm run lint`, `7e2bf4987`; later changes are documentation only | Exit 0; 0 errors, 275 warnings; anti-slop 0 diagnostics across 2150 files | `/tmp/durindoor-docs-lint-final.log` |
| Production website build | `NEXT_DIST_DIR=.next-docs-final npm run build` from `website/`, final source revision | Exit 0 | `/tmp/durindoor-docs-build-verified.log` |
| Production browser suite | `DOCS_BASE_URL=http://localhost:3004 npm run test:docs` from `website/`, final source revision | 7 passed, 31.1 seconds | `/tmp/durindoor-docs-browser-verified.log` |
| Separate-package full CI | `cd tests && npm run test:ci`, Node 20.20.2 / npm 10.8.2, final source revision | Exit 0; 11985 passed, 0 failed, 65 pending/skipped; raw regressions 0 | `/tmp/durindoor-docs-ci-verified.log` |
| Baseline additions | `BASELINE_BASE_REF=origin/main node tests/__baseline__/verify-baseline-diff.mjs`, source unchanged from final source revision; executed at `64a87ad47` | Exit 0; no additions | `/tmp/durindoor-docs-baseline-verified.log` |
| Commit subjects | `npx commitlint --from=origin/main --to=HEAD`, final source revision | Exit 0 | `/tmp/durindoor-docs-commitlint-verified.log` |

Build/browser tools used Node 26.10.0 / npm 11.19.1. The full CI gate uses the pinned Node version. Full local logs are temporary host artifacts; this report retains commands, revisions, and outcomes. Protected PR checks can provide remote execution evidence for the final branch revision.

Browser checks visit every public documentation route and assert HTTP 200 without console errors, search after demo navigation, zero serious/critical axe findings on sampled pages, phone overflow, hero/demo navigation, docs onboarding links and themes, and internal-route/search/asset exclusions. The old `/docs/contributing` pages, brand Markdown/prompts, and vector archive return 404. Runtime SVG assets and the public API guide return 200. Screenshots are retained locally under `.omc/plans/docs-fumadocs/notes/26-screenshots/`.

## Failed attempts and corrections

The earlier passing boundary-only checks and pre-integration full CI do not establish that the complete rewrite passed. An integrated full run reported two failures: the JWT-example scanner interpreted a `printf` format string as a literal secret, and the MITM recovery wording no longer matched its preserved regression contract. The Docker command still generated random secrets; it now uses separate variable-name arguments so the scanner can distinguish them. The explicit instruction `Never raw-kill the recorded PID` was restored without changing its recovery meaning. Both checks pass in the focused final run and the fresh complete CI retry. No runtime authentication code or baseline entry was changed.

An earlier rewritten initial-password placeholder was not in the runtime guarded set. The existing test reproduced that failure; examples now use the already-guarded `CHANGE_ME_STRONG_PASSWORD` and instruct operators to replace it.

## Limits

These checks establish repository contracts and browser publication behavior. They do not prove that an external vendor accepts a real account, that an IDE has trusted the local certificate, or that a deployed database cutover succeeds. No provider credentials, operator data stores, or stored secrets were read or modified. Existing lint warnings are not new passing assertions. No baseline entries were added.
