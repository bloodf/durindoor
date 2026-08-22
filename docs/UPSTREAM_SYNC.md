# Upstream Sync Watch

Last reviewed sync window: **2026-08-05 through 2026-08-20**.

| Source | Reviewed head |
| --- | --- |
| `decolua/9router` | `699edac3273e13d4744bc46f6082618f08560702` |
| `diegosouzapw/OmniRoute` | `abd4df63dc25479853d0b7410f59d4c1b5816ccc` |

Use these heads as the lower-bound anchors for the next sync review. Complete
per-item dispositions for this window live in
[`docs/campaigns/upstream-omniroute-2026-08-14-audit.md`](campaigns/upstream-omniroute-2026-08-14-audit.md).

## Open upstream pull requests

Unmerged changes stay on the watch list; do not port them until their final merged diff is available.

| PR | Title | Why it matters | Port trigger |
| --- | --- | --- | --- |
| [#3012](https://github.com/decolua/9router/pull/3012) | `fix(cooldown): honour provider-reported quota reset times instead of re-probing spent accounts` | Overlaps DurinDoor quota cooldown policy. | After merge, compare with `open-sse/services/quota/` normalization and cooldown scheduling. |
| [#2997](https://github.com/decolua/9router/pull/2997) | `fix(proxyFetch): add undici connection pooling to prevent connection exhaustion` | Potential throughput and connection-pressure improvement for `proxyFetch`. | After merge, require a load test before adoption. |
| [#10358](https://github.com/diegosouzapw/OmniRoute/pull/10358) | `feat(sse): add GLM-5.3 models and effort tiers` | GLM-5.3 catalog addition was independently verified against Z.ai Coding Plan documentation and ported from merged commit `8ed9da7165340`; upstream effort tiers remain unmerged. | Re-evaluate effort tiers only after this PR merges and its final diff is available. |

The 43 correctness and security rows from that audit were **re-verified against
`origin/main` `1c74403cb` on 2026-08-21**, which overturned 10 of them; use those
verdicts, not the audit-date ones:
[`docs/campaigns/upstream-9router-2026-08-21-reverification.md`](campaigns/upstream-9router-2026-08-21-reverification.md).

The GAP/PARTIAL rows from that shortlist were squash-merged into main on 2026-08-22
(maintainer request). Merge SHAs and URLs:
[`docs/campaigns/upstream-9router-2026-08-21-port-closeout.md`](campaigns/upstream-9router-2026-08-21-port-closeout.md).

Full 2026-08-20 open-PR + commit-gap verdicts live in
[`docs/campaigns/upstream-9router-2026-08-20-ledger.md`](campaigns/upstream-9router-2026-08-20-ledger.md);
the ported 2026-08-18 shortlist and its batch gates live in
[`docs/campaigns/upstream-open-pr-shortlist-2026-08-18.md`](campaigns/upstream-open-pr-shortlist-2026-08-18.md).

Full open-PR inventories for the 2026-08-11 review are recorded in
[`docs/campaigns/upstream-9router-open-pr-audit-2026-08-11.md`](campaigns/upstream-9router-open-pr-audit-2026-08-11.md)
and [`docs/campaigns/upstream-omniroute-2026-08-11-audit.md`](campaigns/upstream-omniroute-2026-08-11-audit.md).
Rows classified ACTIVE-EVALUATION already have an open DurinDoor PR; every other
row stays watchlisted under the rule above.

## Deferred upstream commits

Reviewed in the 2026-08-09 window and deliberately NOT ported. Each carries the
concrete trigger that would justify revisiting it.

| Commit | Subject | Port trigger |
| --- | --- | --- |
| `0648e9e4` | IntelliJ h2c upgrade | A reproducible JetBrains-runtime request that fails against `custom-server.js`. |
| `786b3013` | standalone static/public copy | Direct evidence of a CLI or PM2 launch failing on missing static assets. |
| `c06cc084` | externalize `open` for Windows xAI refresh | Confirmation that this fork's xAI service imports `open`. |
| `9138c993` | CodeBuddy CN filter / INT normalization | A real affected CodeBuddy account or request. |
| `13ed1456` | Claude global header-cache removal | Superseded by PR #3023, which closed unmerged; revisit only with a merged upstream diff. |
| `d0751bcf` | Grok CLI public tier label | Grok OAuth deployed in this fork (`planFromAccessToken` is absent today). |
| `25e4bf1c` | CLI package complete API artifacts | A CLI build-artifact failure. |
| `c570fe33` | Xiaomi MiMo TTS | An explicit request for the vendor; new-vendor surface. |
| `b11be8be` | remove retired Gemini 3.0 quota tiers | A live upstream quota response confirming the old IDs are retired. |
| `02c66fe2` | first-run Default Key provisioning | A deliberate decision to auto-create credentials; deferred to avoid silent key creation. |
| `fe547f4d` | self-hosted STT/TTS/Embedding | Local demand for self-hosted media services. |
| `41588bea` | TokenRouter pricing + thinking config | Refreshed prices from the provider source rather than the stale upstream static table. |
| `86131b9c` | Codex GPT-5.6 Max/Ultra overrides | Deferred until the unified limits resolver lands, so the executor consumes it rather than forking thinking-level logic. |
