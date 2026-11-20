# #800 upstream scan reconciliation

Reviewed 2026-11-20. This reconciles the historical open-PR scan in [#800](https://github.com/bloodf/durindoor/issues/800) with the later 9router intake recorded in [#1072](https://github.com/bloodf/durindoor/issues/1072) and the closed intake-design delivery [#1148](https://github.com/bloodf/durindoor/issues/1148). The 21-day review window is **2026-10-29 through 2026-11-19**, pinned by the owner to upstream `decolua/9router` head [`1855aa44473e88feac9d3f131b9c0c5fc9706b68`](https://github.com/decolua/9router/commit/1855aa44473e88feac9d3f131b9c0c5fc9706b68), v0.5.119. The foundation/content base is [`1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`](https://github.com/decolua/9router/commit/1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d), v0.5.112 (2026-10-28). This report preserves the original findings as dated evidence; GitHub state can change after the pinned intake.

## Historical #800 scan

Issue #800 was created 2026-09-05. Its body reports a scan of 883 open upstream PRs: 166 matched the then-current local port set and 717 were listed as unported across the body and continuation comment. The snapshot includes PRs down to #1. It is an open-PR snapshot, not an inventory of merged upstream changes, issues, final diffs, or subsequent fork ports. Its candidates remain useful historical leads; “unported” means only “not detected by that scan at that time,” not a current port recommendation.

The scan's source is `scripts/upstream-scan-report.sh` in classic mode: it subtracts IDs from supplied upstream PR JSON and supplied ported-ID JSON, then renders all remaining PRs newest first. Its companion `scripts/upstream-ported-ids.sh` collects `port(upstream): #N` and grouped `#A+#B` commit subjects, plus eligible entries in `.github/upstream-ported.json`. The ledger is source-qualified; legacy entries with no source count as 9router, while explicit other sources do not. The scripts do not decide technical applicability, inspect diffs, detect independently implemented behavior absent a ledger entry, or keep the September body current. The report's two-page commented list is a point-in-time source artifact, not a live canonical ledger.

Later existing detection is broader than that historic snapshot but still bounded: the commit subject and ledger mechanisms above can detect landed ports; the `#1072` intake adds state, source, diff, local-equivalent, test, disposition, and owner-issue evidence. `#1148` delivered the local multi-upstream report builder and documented those provenance fields; it did not replace classic scan semantics, create a duplicate inventory, or authorize scheduled runs. The current upstream-sync procedure describes the manual workflow and keeps the dispatch-only workflow as fallback.

## 21-day intake and later coverage

The owner's three #1072 triage comments cover 118, 117, and 119 updated PR records respectively (overlapping boundary records are possible), anchored to the pinned head and the `1fe586bb..1855aa44` upstream range. Page 1 records 25 already-in, 81 port-candidate, and 11 not-applicable dispositions. The later comment pages record changed paths and candidate state, but explicitly treat title/commit matches as triage signals rather than proof that behavior is equivalent. The issue's subsequent delivery comments link landed DurinDoor PRs and identify source PRs, giving later coverage unavailable to #800:

- [DurinDoor #2045](https://github.com/bloodf/durindoor/pull/2045) ports source PRs #4612, #4706, #4774, #4791, #5308, #5311, #5330, #5349, #4518, #5323, #5350, #5372, #3987, #5529, #5660, #5679, #5688, and #5697 (among others in the linked intake disposition).
- [DurinDoor #2046](https://github.com/bloodf/durindoor/pull/2046) ports #5634, #5637, #5640, #5671, and #5678.
- [DurinDoor #2055](https://github.com/bloodf/durindoor/pull/2055) ports #4752, #5054, #5131, #5313, #5373, #5415, #5492, #5518, #5587, #5589, #5603, #5609, #5615, #5622, and additional listed sources through #5768.
- [DurinDoor #2056](https://github.com/bloodf/durindoor/pull/2056) ports #5638 and #5767; it also ports the shared browser-pool portion of #5658, while the Muse-specific portion is inapplicable.

These deliveries supersede those candidates' earlier unported/candidate labels for the covered behavior. Check the linked PRs for the exact scope; a source PR can contain excluded or fork-specific portions.

## Follow-up still required from the 21-day intake

The intake's **81 port-candidate** rows are review candidates, not 81 confirmed omissions. The following remain explicit follow-up leads in the issue record because no later delivery listed here resolves their behavior; retain the source-state shown in the pinned triage and recheck current upstream before acting:

| Source PR | State at pinned intake | Follow-up / alternate source |
| --- | --- | --- |
| [#5580](https://github.com/decolua/9router/pull/5580) | closed | Candidate for OpenCode settings effort variants and model listing; closed upstream but not identified as ported in the later delivery comments. Recheck its final diff and the local implementation. |
| [#5575](https://github.com/decolua/9router/pull/5575) | open | Large combo behavior change; inspect final diff and current state before splitting actionable behavior. |
| [#5574](https://github.com/decolua/9router/pull/5574) | open | Combo/RTK behavior; inspect final diff and local equivalents. |
| [#5571](https://github.com/decolua/9router/pull/5571) | open | Image-provider/registry change; check applicability and registry requirements. |
| [#5566](https://github.com/decolua/9router/pull/5566) | open | Ollama catalog/model-catalog behavior; check current local catalog path and tests. |
| [#5563](https://github.com/decolua/9router/pull/5563) | open | DSML translator/tool-call change; compare source diff and translator behavior. |
| [#5562](https://github.com/decolua/9router/pull/5562) | open | Antigravity/runtime/combo behavior; inspect final diff and local equivalents. |
| [#5560](https://github.com/decolua/9router/pull/5560) | open | Codex capability/streaming behavior; verify against the current provider path. |
| [#5548](https://github.com/decolua/9router/pull/5548) | open | Image edits endpoint; assess whether the source feature and API contract fit this fork. |
| [#5547](https://github.com/decolua/9router/pull/5547) | open | Media-provider/dashboard changes; check the exact changed paths and existing UI. |
| [#5545](https://github.com/decolua/9router/pull/5545) | open | API-key rotation and endpoint behavior; review against the fork's auth contract. |
| [#5528](https://github.com/decolua/9router/pull/5528) | open | Multipart proxy behavior; compare with current proxy fetch handling. |
| [#5511](https://github.com/decolua/9router/pull/5511) | open | Codex catalog behavior; compare with the fork's live catalog routes. |
| [#5510](https://github.com/decolua/9router/pull/5510) | open | Non-streaming executor behavior; inspect all changed paths and tests. |
| [#5502](https://github.com/decolua/9router/pull/5502) | open | Grok video reference validation; compare provider support and validation path. |
| [#5499](https://github.com/decolua/9router/pull/5499) | open | Antigravity response translation registration; inspect final diff and tests. |
| [#5496](https://github.com/decolua/9router/pull/5496) | open | Large Codex/Claude core change; decompose and review before any port decision. |
| [#5491](https://github.com/decolua/9router/pull/5491) | open | Combo/auth behavior; review local routing and authentication constraints. |
| [#5488](https://github.com/decolua/9router/pull/5488) | open | OpenAI reasoning alias collision; confirm current format behavior. |
| [#5487](https://github.com/decolua/9router/pull/5487) | open | Azure token-limit behavior; compare the current executor and tests. |
| [#5467](https://github.com/decolua/9router/pull/5467) | open | Broad combo/model cleanup UI; assess scope and local model-management behavior. |
| [#5465](https://github.com/decolua/9router/pull/5465) | open | Model capability probing; compare current probe filters and test coverage. |
| [#5464](https://github.com/decolua/9router/pull/5464) | open | Provider model listing; compare current fetch/listing route. |
| [#5458](https://github.com/decolua/9router/pull/5458) | open | LLMTR provider plus parameter support; verify registry, schema and generated-index implications. |
| [#5447](https://github.com/decolua/9router/pull/5447) | open | Combo change; compare with other combo candidates before choosing a source. |
| [#5444](https://github.com/decolua/9router/pull/5444) | open | Combo max-output capability; compare current capability catalog. |
| [#5441](https://github.com/decolua/9router/pull/5441) | open | SSE keepalive behavior; compare stream framing and callers. |
| [#5437](https://github.com/decolua/9router/pull/5437) | open | Kiro executor behavior; compare current request shape. |
| [#5436](https://github.com/decolua/9router/pull/5436) | open | Dependency override for `deepmerge`; the earlier #1072 app-5 review says the fork's tracked locks do not contain that dependency, so use that local dependency evidence as the alternate source and close as not applicable if still true. |
| [#5433](https://github.com/decolua/9router/pull/5433) | open | Combo/database changes; assess migration and data-safety requirements. |
| [#5432](https://github.com/decolua/9router/pull/5432) | open | Anthropic live model listing; compare current `/v1/models` behavior. |
| [#5431](https://github.com/decolua/9router/pull/5431) | open | Claude API-key system handling; verify existing translator behavior and test. |
| [#5425](https://github.com/decolua/9router/pull/5425) | open | Large chat-core change; inspect final diff and impacted callers. |
| [#5424](https://github.com/decolua/9router/pull/5424) | open | Request-detail rendering; compare local UI and tests. |
| [#5423](https://github.com/decolua/9router/pull/5423) | open | Headroom process management; earlier #1072 app-5 review identifies fork-specific process behavior, so revisit that local contract before considering a port. |
| [#5420](https://github.com/decolua/9router/pull/5420) | open | CLI foreground behavior; compare launcher/process ownership behavior. |
| [#5393](https://github.com/decolua/9router/pull/5393) | open | Large broad change; split and assess changed paths before any disposition. |
| [#5386](https://github.com/decolua/9router/pull/5386) | open | Gemini/Antigravity translation and API route; compare the current translator and beta endpoint. |
| [#5384](https://github.com/decolua/9router/pull/5384) | open | Non-streaming response behavior; inspect final diff and relevant regression tests. |
| [#5380](https://github.com/decolua/9router/pull/5380) | open | SSE error conversion in non-streaming responses; compare local response shape. |
| [#5378](https://github.com/decolua/9router/pull/5378) | open | Gemini/non-streaming behavior; compare local translation and response handling. |
| [#5374](https://github.com/decolua/9router/pull/5374) | open | Stream disconnect abort handling; compare existing cancellation paths. |
| [#5361](https://github.com/decolua/9router/pull/5361) | open | Provider shared helper change; inspect exact diff and call sites. |
| [#5356](https://github.com/decolua/9router/pull/5356) | open | Model modifier/chat-core behavior; compare with the fork's current model modifiers. |
| [#5336](https://github.com/decolua/9router/pull/5336) | open | General credential reauthentication quarantine; earlier app-5 review notes only provider-specific quarantine locally. Compare against #3194 and keep the source distinct until overlap is verified. |
| [#5298](https://github.com/decolua/9router/pull/5298) | open | Large native MCP bridge; requires an explicit product-scope decision. |
| [#5316](https://github.com/decolua/9router/pull/5316) | open | Combo session stickiness; compare with the competing combo designs #4704/#4975 before selecting a source. |

This is a follow-up queue, not an implementation authorization. Rows not enumerated above remain available in the complete dated tables on #1072; use their recorded state and changed-file evidence rather than treating absence from this short queue as a disposition. The later #1072 notes explicitly identify additional live candidates, including #5711, #5336, and #5423; #5712 is already covered by the fork's `processScan.js` and unit test, #1680/#2845/#4175 were found closed-unmerged or superseded per the app-5 review, and #4291 was deferred for size. For superseded or closed sources, verify the linked alternate/local evidence before reopening work.

No workflow was dispatched or changed for this reconciliation.
