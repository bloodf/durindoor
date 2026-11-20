# 1073: Historical OmniRoute source coverage, reconciled

Reviewed 2026-11-20. Unit: `reconcile-omni-history-evidence`.

Scope: reconcile the archived OmniRoute source inventory collected on [#1073](https://github.com/bloodf/durindoor/issues/1073) against local DurinDoor evidence, and correct the ancestry-only classification that the earlier provenance note used for the same archive.

Method is read-only. Upstream metadata and issue bodies were fetched over the GitHub API; local Git ancestry and static source comparison were read from the working tree; the issue's own comment bodies were re-parsed. No runtime code was added, no fixture was written, no provider was called, no credential was used, and no request was issued to study any exposure. The only executed test is the existing synthetic local one named in §7. This is a documentation unit.

Gate: Heitor's orq gate overrides the earlier HOLD and the independent gate-receipt rules for this unit. No owner selection was performed and no selection list is produced.

## 1. Pinned references

| Pin | Value | Date |
| --- | --- | --- |
| Public `origin/main` | `dc7ba501fa5b036c46b7788ce929d4d8e5e10c3f` (`fix(usage): attribute API-key limits to stable IDs (#2082)`) | 2026-11-20 |
| Unit HEAD | `936cb835b865c6961196264db43292f09072f7d6` | 2026-11-20 |
| OmniRoute reviewed window | 2026-09-30 → 2026-10-06, `release/v3.8.52` | `internal/docs/upstream-sync.mdx` |
| OmniRoute reviewed head | `77bca6f878180006f3a679b53400d55a344fcd83` | `internal/docs/upstream-sync.mdx` |
| 9router reviewed head | `1855aa44473e88feac9d3f131b9c0c5fc9706b68` (v0.5.119) | `internal/docs/upstream-sync.mdx` |
| Archive collection | 2026-10-08, 38 comment pages | #1073 body |
| Landed #1073 triage comments | 2026-11-19T21:02Z → 2026-11-20T12:10Z | #1073 comment bodies |

Two naming facts about the upstream metadata, because they change how ids must be read:

- The `upstream` git remote in this checkout is `decolua/9router`, not OmniRoute. OmniRoute is referenced by the archive and by `internal/docs/upstream-sync.mdx` under `diegosouzapw/OmniRoute`; the later #1073 triage comments use the moved `cheaper-inference/OmniRoute` path. Both name the same upstream project and share one id space, so an id means the same upstream pull request under either path.
- `internal/docs/upstream-sync.mdx` is the existing upstream metadata. This unit reads it and does not change it.

## 2. The archive, re-parsed from its own comment bodies

Re-parsing all 38 archive pages of #1073 recovers **15,357** rows and reproduces the state counts published in the issue body exactly:

| Bucket | Count |
| --- | --- |
| Issues CLOSED | 4,792 |
| Issues OPEN | 163 |
| PRs MERGED | **8,409** |
| PRs CLOSED | 1,771 |
| PRs OPEN | 222 |
| **Total records** | **15,357** |

The 8,409 merged rows carry 8,409 distinct upstream PR ids, and the highest merged id in the archive is #15,937.

**The 8,409 is a count of archive records, not of ports.** It is a denominator for this archive and is never used here as a numerator.

Two boundaries follow from the 2026-10-08 collection date and constrain every statement below.

1. OmniRoute PRs numbered above #15,937 are absent from the archive entirely, and PRs that merged after 2026-10-08 remain in the archive's OPEN bucket rather than the MERGED bucket.
2. The archive therefore cannot describe the modern upstream period at all. Every port landed after 2026-10-08 names an upstream PR that the archive cannot contain. §5 covers how those are evidenced instead.

## 3. The correction: three axes that ancestry alone cannot answer

The earlier provenance note classified a merged archive record as "integrated" only when the local port commit was an ancestor of `main`. That test is sound for what it measures, but it is a *tree* test, not a *coverage* test, and it mislabels an approved, merged, behaviorally-present port as uncovered. Three distinct facts have to be held apart:

| Axis | Question | Source of truth |
| --- | --- | --- |
| **Original local merge** | Was there an approved and merged DurinDoor commit that ported the upstream PR? | `port(omniroute)` commit bodies and subjects; the landed #1073 triage comments |
| **Current equivalent behavior** | Is the upstream behavior present in the current tree today, by whatever route it arrived? | Current source comparison against the upstream diff |
| **Exact current ancestry** | Is that *original* port commit an ancestor of the current head? | `git merge-base --is-ancestor` |

A record can satisfy all three, one, or none. Reporting only the third understates coverage and, worse, reports an approved merge as an absence.

### 3.1 Worked example: OmniRoute #6620

This is the case the ancestry-only classification got wrong, and it is stated explicitly on #1073 by the landed triage comment dated 2026-11-20T12:10:11Z (comment `7039188415`):

> Historical disposition for OmniRoute #6620: already present. It landed originally in DurinDoor #184. The current proxy implementation still uses CONNECT for proxied HTTP targets through its existing dispatcher. The historical merge commit and the current source tree provide separate evidence.

The three axes resolve as follows, each independently checkable:

| Axis | Value | Check |
| --- | --- | --- |
| Original local merge | DurinDoor #184, commit `29ba2288e` — `port(omniroute): force CONNECT tunnel for HTTP-proxied requests (#6620) (#184)`, approved and merged 2026-07-10, body: "Ported from diegosouzapw/OmniRoute#6620 @ 0eda8ab09c (proxyTunnel only; …)" | `git show 29ba2288e` |
| Current equivalent behavior | Present. `open-sse/utils/proxyFetch.js:583` sets `proxyTunnel: true` on the `ProxyAgent` built by `getDispatcher`, which is the dispatcher `proxyAwareFetch` uses for both the MITM-bypass and the normal proxied path | `rg -n 'proxyTunnel: true' open-sse/utils/proxyFetch.js` |
| Exact current ancestry | **Not** in current ancestry. `29ba2288e` is not an ancestor of `origin/main` or of the unit HEAD | `git merge-base --is-ancestor 29ba2288e origin/main` → exit 1 |

The behavior reached the current tree by a different route. `git log -S 'proxyTunnel' --oneline origin/main -- open-sse/utils/proxyFetch.js` yields exactly one commit — `cb40de41d` (`merge: DurinDoor 2.0.0 release (#321)`) — and `cb40de41d` *is* an ancestor of `origin/main`. The current tree therefore carries the CONNECT-tunnel option through the release merge, not through the original #184 commit.

The distinction that matters: the original merge is real and approved; the current behavior is real and present; the two are not the same commit, and an ancestry-only check answers only the third question. The existing synthetic regression guard `tests/unit/proxy-connect-tunnel.test.js` names OmniRoute #6620 in its header and locks the behavior against a local CONNECT-only proxy; it passes at this head (§7).

## 4. Classification over the 8,409 merged records

Rule, applied mechanically to every local commit: a merged-archive record has a **local port-body reference** when some commit whose subject declares `port(omniroute)` names the upstream PR in its subject or body. Two forms are credited:

- **Anchored** — the id appears explicitly as `OmniRoute #N` (or `OmniRoute#N`).
- **Bare companion** — the id appears as a bare `#N` inside the *same* port sentence as an anchored id, e.g. "Ports OmniRoute #14542 (…), #14243 (…)".

The trailing `(#N)` in a subject is this repository's own PR number and is never read as an upstream id.

| Class | Count | Ids |
| --- | --- | --- |
| **A1.** Anchored, port commit **is** in current ancestry | **23** | #10920, #11083, #11104, #11190, #11812, #11997, #12620, #12631, #12742, #13153, #13255, #13448, #13673, #14237, #14356, #14460, #14542, #14582, #14585, #14632, #14650, #14712, #15589 |
| **A2.** Bare companion, port commit **is** in current ancestry | **15** | #14122, #14123, #14173, #14215, #14234, #14243, #14247, #14279, #14572, #14596, #14609, #14615, #14649, #14673, #14694 |
| **B1.** Anchored, port commit **not** in current ancestry | **6** | #6423, #6542, #6620, #6730, #6907, #6937 |
| **B2.** Bare companion, port commit **not** in current ancestry | **4** | #6451, #6541, #6543, #6645 — all four marked **out of scope** in the body, i.e. mentions, not ports |
| **Total merged-archive records with a local port-body reference** | **48** | |
| — of which the port commit is in current ancestry | **38** | |
| — of which the port commit is not in current ancestry | **10** | |

Of the 38 in-ancestry records, 37 are ancestors of `origin/main`; #12620 is on the integration line only. Of the 10 out-of-ancestry records, 6 are genuine port claims (§4.1) and 4 are out-of-scope mentions.

Class A id list, with the port commit that establishes it:

| Upstream PRs | Port commit | In `origin/main`? |
| --- | --- | --- |
| #10920, #11104 | `94db82c919` | yes |
| #11083, #12631 | `bfc0604651` | yes |
| #11190, #13673 | `9fddcd8381` | yes |
| #11812, #11997, #14356 | `19fc353904` | yes |
| #12742, #13448 | `c5d5f7ba12` | yes |
| #13153, #14582, #14585 | `7d8d1eba7d` | yes |
| #13255 | `1debd17f35` | yes |
| #14237, #14673 | `82c0ce2232` | yes |
| #14460, #14123, #14279, #14173 | `9bf6cf1036` | yes |
| #14542, #14243, #14234, #14215, #14122, #14694 | `0421c0f135` | yes |
| #14632, #14572, #14247 | `1c3d05d22c` | yes |
| #14650, #14615, #14609, #14649, #14596 | `9420208533` | yes |
| #14712 | `693d2b7299` | yes |
| #15589 | `c6d4df0e2d` | yes |
| #12620 | `5daa01bb1` | no — HEAD only |

One id set is deliberately **not** counted at all:

- #15307 is named by local ports but is an archive **issue**, not one of the 8,409 merged PRs.

This rule is a **floor**, not a ceiling. Three further merged-archive members — #11703, #11970 and #13630 — are named as bare companions in a port sentence that does not itself carry a port verb, so the rule does not credit them; they are inside the margin. Any use of 48 or 38 as a coverage figure would be a misuse of it: the rule counts *evidence found*, and it deliberately excludes records whose upstream id was never written down locally.

### 4.1 Class B1 — every one is behaviorally present in the current tree

The six class B1 records are not gaps. Each was checked against the current source:

| Upstream PR | Original local merge | Current-tree evidence | Note |
| --- | --- | --- | --- |
| #6620 | `29ba2288e` (DurinDoor #184) | `open-sse/utils/proxyFetch.js:583` — `proxyTunnel: true` on the `ProxyAgent` in `getDispatcher` | Behavior present via `cb40de41d`; see §3.1 |
| #6423 | `29ba2288e` (body: "Happy Eyeballs (autoSelectFamily) for direct egress (OmniRoute #6423) is already present on dev") | `open-sse/utils/proxyFetch.js:63` — `setGlobalDispatcher(new Agent({ connect: { autoSelectFamily: true } }))`, plus `:616–617` | Named as already present, not as a separate port |
| #6730 | `9617b363de` | `open-sse/translator/response/openai-to-claude.js:103–105` — "still reserved a block index but deferred its content_block_start … (OmniRoute#6730 edge case)" | The current tree cites the upstream id inline |
| #6937 | `316ee5ca1b` | `open-sse/translator/response/openai-responses.js:596–604` — `response.custom_tool_call_input.delta` / `.done` | Body: "Source diff is OmniRoute #6937" |
| #6542 | `3d00c34691` | `open-sse/utils/outboundUrlGuard.js` | SSRF outbound guard |
| #6907 | `2ec735e584` | `open-sse/services/combo/contextRequirements.js`, `tests/unit/combo-context-requirements.test.js` | **Source identity is title/plan-row derived** — the body itself says the plan row '6905' maps to source PR #6907. The behavior is present and locally tested; the upstream id attribution is not independently proven |

So the correct statement for class B1 is: these six were ported by approved local merges that are not in current ancestry, and their behavior is nonetheless present today. Five of the six have a verified upstream identity; #6907 does not, and its upstream attribution stays unverified.

## 5. Modern squashes: the landed #1073 comments and the 1073 port reports

The 2026-10-08 archive cannot describe the modern upstream period, and modern port commits often do **not** name their upstream PR in the commit body. For those, the upstream-PR identity lives in the **landed #1073 triage comments**, and the local per-source record lives in the **`internal/docs/port-reports/1073-*.md`** reports. Both channels were read.

**Landed #1073 triage comments.** 31 comments were posted on #1073 between 2026-11-19T21:02Z and 2026-11-20T12:10Z, each naming the upstream PRs carried by a specific landed DurinDoor PR:

| Landed DurinDoor PR | Comment date (UTC) | Upstream OmniRoute PRs named |
| --- | --- | --- |
| #2042 | 2026-11-20T02:02Z | #15631 |
| — (dispositions) | 2026-11-20T02:09Z | #15688, #15686, #15674, #15647 |
| — (dispositions) | 2026-11-20T02:28Z | #15561, #15543, #15559 |
| #2055 | 2026-11-20T05:34Z | #15757, #15932, #15968, #15974, #15987 |
| #2059 | 2026-11-20T06:30Z | #15974 (follow-up on the #2055 port) |
| #2060 | 2026-11-20T06:37Z | #16644, #16698 |
| #2067 | 2026-11-20T09:03Z | #17105, #17144, #17217, #17898, #18052, #18265, #18780, #18806, #18823, #19250, #19407, #19665, #20525, #20547, #20590, #20600, #20651, #20688 |
| — (dispositions) | 2026-11-20T09:13Z | #15688, #15686, #15561, #15674, #15647, #15559, #15962, #19347, #20517, #19602, #20537, #20587, #20523, #20712, plus #19626, #19639, #19972, #20343, #20510, #20683 (deferred upstream merge readiness) |
| #2073 | 2026-11-20T10:26Z | #19557, #15628, #20610, #20095 |
| #2075 | 2026-11-20T10:53Z | #19575, #19403, #20559, #19638, #19628, #20581, #20507, #20571, #20640 |
| #2076 | 2026-11-20T11:02Z | #16617, #18142, #18575, #16537, #18677, #19667, #20586, #20696, #20508, #20656 |
| #2077 | 2026-11-20T11:10Z | #19666, #20590, #15566, #15543, #20482 |
| #2078 | 2026-11-20T11:19Z | #15628 |
| — (#6620 disposition) | 2026-11-20T12:10Z | #6620 |

The landing commits for those PRs are in current ancestry, which is what makes them a *modern squash* rather than a claim: the port is in the tree, and the upstream identity is recorded on the issue rather than in the commit body. Verified landing commits:

| Landed PR | Merge commit in current ancestry |
| --- | --- |
| #2055 | `1a3963769` |
| #2067 | `4d12b6908` |
| #2081 | `f04ffa699` |

Worked example: OmniRoute #20688 ("Resolve the incompatible forced DeepSeek tool choice when thinking is enabled") landed in DurinDoor #2067, whose merge commit `4d12b6908` is an ancestor of the current head. The upstream id #20688 is **outside** the archive — the archive's highest merged id is #15,937 — so no archive row can describe it, and a coverage claim derived from the archive alone would miss it entirely.

Across the 31 triage comments, 3,321 distinct upstream OmniRoute PR ids are named. Of these, 409 are members of the 8,409 merged archive and 2,912 are outside it: 2,735 are absent from the archive entirely, and 177 sat in the archive's OPEN bucket at collection time.

**The `1073-*` port reports.** The eight `internal/docs/port-reports/1073-*.md` records name 29 distinct upstream OmniRoute PR ids. Four are members of the merged archive (#12620, #15543, #15566, #15628); the other 25 are outside the archive window (#16537, #16617, #18142, #18575, #18677, #19403, #19557, #19575, #19628, #19638, #19666, #19667, #20095, #20482, #20507, #20508, #20559, #20571, #20581, #20586, #20590, #20610, #20640, #20656, #20696). Their local commits are in current ancestry, so they are integrated behavior whose upstream ids the archive cannot represent.

The two channels are complementary: the port reports give a dated, per-source local record; the #1073 comments give the upstream-PR identity for ports whose commit bodies omit it. Neither alone is sufficient for the modern period.

## 6. The remaining archive is unverified, not absent

Of the 8,409 merged archive records, 48 carry a local port-body reference (§4). The remaining **8,361** records carry no local port-body evidence in this unit.

That is an absence of local evidence, not evidence of absence. The remaining 8,361 are **unverified**: this unit performed no diff-level applicability read for them, and nothing here asserts that they are unported, inapplicable, or outstanding. Large parts of the archive are OmniRoute's own CI, release, dashboard and quality-gate machinery, which has no counterpart in a self-hosted gateway, but this unit did not measure which parts those are and makes no claim about the split.

No coverage percentage, coverage ratio, or backlog size is asserted here. The only totals reported are the 8,409 archive records (§2, reproduced from the issue's own bodies) and the 48 records with a local port-body reference (§4, reproduced by a stated mechanical rule over local commits and explicitly labelled a floor). Both are counts of *evidence*, not of coverage.

## 7. Exact reproducible static checks

All commands are read-only and run from the repository root. Observed output is from 2026-11-20 against `origin/main` = `dc7ba501fa5b036c46b7788ce929d4d8e5e10c3f`.

```bash
# C1 — archive merged count, read from the #1073 issue body
gh api repos/bloodf/durindoor/issues/1073 --jq .body | grep -o '"MERGED": [0-9]*'
#   "MERGED": 8409

# C2 — the CONNECT-tunnel implementation is present in the current tree
rg -n 'proxyTunnel: true' open-sse/utils/proxyFetch.js
#   571:    // proxyTunnel: true forces a CONNECT tunnel even for plain-HTTP targets.
#   583:      proxyTunnel: true,

# C2b — the same line at the pinned public origin/main
git show origin/main:open-sse/utils/proxyFetch.js | grep -n 'proxyTunnel: true'
#   571:    // proxyTunnel: true forces a CONNECT tunnel even for plain-HTTP targets.
#   583:      proxyTunnel: true,

# C3 — the original #184 port commit is NOT in current ancestry (expect exit 1)
git merge-base --is-ancestor 29ba2288e origin/main; echo "exit=$?"
#   exit=1
git merge-base --is-ancestor 29ba2288e HEAD; echo "exit=$?"
#   exit=1

# C4 — the commit that actually introduced proxyTunnel into current ancestry
git log -S 'proxyTunnel' --oneline origin/main -- open-sse/utils/proxyFetch.js
#   cb40de41d merge: DurinDoor 2.0.0 release (#321)

# C5 — that commit IS in current ancestry (expect exit 0)
git merge-base --is-ancestor cb40de41d origin/main; echo "exit=$?"
#   exit=0

# C6 — the pinned public origin/main
git rev-parse origin/main
#   dc7ba501fa5b036c46b7788ce929d4d8e5e10c3f

# C7 — the original local merge for OmniRoute #6620
git show -s --format='%H%n%s' 29ba2288e
#   29ba2288e08d7f8879db059b5fdf8ca791771811
#   port(omniroute): force CONNECT tunnel for HTTP-proxied requests (#6620) (#184)

# C8 — the other class B port commits are all outside current ancestry (expect exit 1 each)
for c in 3d00c34691 9617b363de 2ec735e584 316ee5ca1b; do
  git merge-base --is-ancestor "$c" origin/main; echo "$c exit=$?"
done

# C9 — class A port commits are inside current ancestry (expect exit 0 each)
for c in 94db82c919 bfc0604651 9fddcd8381 19fc353904 c5d5f7ba12 7d8d1eba7d \
         1debd17f35 82c0ce2232 9bf6cf1036 0421c0f135 1c3d05d22c 9420208533 \
         693d2b7299 c6d4df0e2d; do
  git merge-base --is-ancestor "$c" origin/main; echo "$c exit=$?"
done

# C10 — the #12620 port is on the integration line but not yet on origin/main
git merge-base --is-ancestor 5daa01bb1 HEAD; echo "HEAD exit=$?"      # 0
git merge-base --is-ancestor 5daa01bb1 origin/main; echo "main exit=$?" # 1

# C11 — modern landing commits are in current ancestry (expect exit 0)
for c in 1a3963769 4d12b6908 f04ffa699; do
  git merge-base --is-ancestor "$c" HEAD; echo "$c exit=$?"
done

# C12 — the existing synthetic CONNECT-tunnel regression guard
cd tests && node node_modules/vitest/vitest.mjs run unit/proxy-connect-tunnel.test.js --maxWorkers=2
#   Test Files  1 passed (1)
#        Tests  1 passed (1)
```

C12 is the only command in this report that executes code. It is an existing test in the tree, uses a local `127.0.0.1` CONNECT-only proxy and a local origin server, touches no external network, and was not modified by this unit.

## 8. Limits of this reconciliation

- **The 8,361 records without a local port-body reference are unverified.** This unit did not perform diff-level applicability reads for them, and asserts nothing about whether they are ported, inapplicable, or outstanding. No coverage total is claimed.
- **The 48-record figure is a floor.** The rule credits an upstream id only when it is written down locally in a port body, so it cannot see a record whose behavior is integrated but whose upstream id was never recorded — precisely the modern-squash pattern of §5, and the reason §5 needs its own evidence channel. The residual 8,361 is correspondingly an upper bound on what is unverified.
- **"Local port-body reference" is a rule about evidence, not about behavior.** A record can be behaviorally present without any commit naming its upstream id — which is exactly the modern-squash pattern of §5 — and it can be behaviorally present with a wrong upstream id, as in the #6907 case of §4.1.
- **No live behavior was verified.** No provider was called and no credential was used. "Current equivalent behavior" here means a static source match against the upstream diff, plus the one synthetic local test in C12.
- **The archive's own fields are a navigation aid.** The title and area columns are not applicability verdicts, and no title is treated as a disposition anywhere in this report.
- **Two upstream pins remain 294 commits apart** in this tree, and the later pin is the catalogue one. Any comparison between a catalogue-derived expectation and a `77bca6f8`-derived expectation crosses that gap rather than sitting inside one snapshot.
