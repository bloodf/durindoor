# Mirror audit — 2026-07-20

## Method
- Enumerated 130 mirror-class refs (pr-, port-src-, up-pr-, om-, pr/omniroute/, heads/omniroute/, omniroute/release/, fork-chirag127/) against current HEAD on `integration/v2.2.0`.
- Verified that 6 of the 11 'must land' items in feat/feat/durindoor-fixes-ports are already on dev in evolved form via prior PRs (headroom, bulkAdd, grokBuild fingerprint, featherless, Thai i18n, kiroSessionReplay). Confirmed by symbol/source inspection at integration time.
- Confirmed that fix/v2/baseline-other-batch2's `agentrouter` transports+per-model targetFormat gap is now landed in HEAD via hand-port commit ac47fc796e.

## Mirror-class ref inventory (deduped by tip OID)
- 130 mirror refs; 122 unique tip OIDs; 8 duplicate-tip groups (all pairs of `port-src-*` and `up-pr-*` pointing at the same commit).
- 1/130 mirror tip is an ancestor of HEAD (the rest are raw upstream snapshots).

## Mapping
- port-src-* and up-pr-* numbering is disambiguated by per-PR docs under `docs/ports/omniroute-*.md` and `docs/ports/upstream-*.md` (21 detailed port docs).
- om-* (OmniRoute) cross-referenced against `docs/ports/omniroute-week-2026-07-07.csv` (436-row inventory with PORT/SKIP/DUPLICATE verdicts).
- heads/omniroute/main cannot map to one port SHA; audited against the full mapped OmniRoute port set.

## Gaps
- Plan-listed gaps (alicode-intl, xai expiresAt, agentrouter transports) are all landed in HEAD via the campaign (commits `ac47fc796e`, `89bdd39e28`).
- Remaining plan gaps (Kiro replay wiring, xAI video CLI registration, secure Deno relay, real PxPipe install route, headroom restart, GitBook Pages workflow fix) are deferred to a post-release branch per `release-cutover-plan.md` § Campaign resolution.
- No additional functional mirror gaps identified beyond what the campaign already captured.

## Conclusion
- Mirror audit complete; campaign equivalent of plan items landed via the campaign (5 hand-port commits).
