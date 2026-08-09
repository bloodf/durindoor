# Upstream Sync Watch

Last reviewed sync window: **2026-08-04 through 2026-08-09**.

| Source | Reviewed head |
| --- | --- |
| `decolua/9router` | `15223724c` |
| `diegosouzapw/OmniRoute` | `918fba5e3` |

Use these heads as the lower-bound anchors for the next sync review. Per-commit
verdicts for this window live in
[`docs/campaigns/upstream-omniroute-2026-08-09-ledger.md`](campaigns/upstream-omniroute-2026-08-09-ledger.md).

## Open upstream pull requests

Unmerged changes stay on the watch list; do not port them until their final merged diff is available.

| PR | Title | Why it matters | Port trigger |
| --- | --- | --- | --- |
| [#3012](https://github.com/decolua/9router/pull/3012) | `fix(cooldown): honour provider-reported quota reset times instead of re-probing spent accounts` | Overlaps DurinDoor quota cooldown policy. | After merge, compare with `open-sse/services/quota/` normalization and cooldown scheduling. |
| [#2997](https://github.com/decolua/9router/pull/2997) | `fix(proxyFetch): add undici connection pooling to prevent connection exhaustion` | Potential throughput and connection-pressure improvement for `proxyFetch`. | After merge, require a load test before adoption. |

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
