# Upstream Sync Watch

Last reviewed sync window: **2026-07-25 through 2026-08-04**.

| Source | Reviewed head |
| --- | --- |
| `decolua/9router` | `6fcd27337` |
| `diegosouzapw/OmniRoute` | `16ed70714` |

Use these heads as the lower-bound anchors for the next sync review.

## Open upstream pull requests

Unmerged changes stay on the watch list; do not port them until their final merged diff is available.

| PR | Title | Why it matters | Port trigger |
| --- | --- | --- | --- |
| [#3023](https://github.com/decolua/9router/pull/3023) | `fix(claude): anthropic-beta header leaking across requests` | DurinDoor shares Claude header-forwarding paths. | After merge, compare the final diff with `open-sse/executors/claude.js` and request-header mutation sites. |
| [#3012](https://github.com/decolua/9router/pull/3012) | `fix(cooldown): honour provider-reported quota reset times instead of re-probing spent accounts` | Overlaps DurinDoor quota cooldown policy. | After merge, compare with `open-sse/services/quota/` normalization and cooldown scheduling. |
| [#2997](https://github.com/decolua/9router/pull/2997) | `fix(proxyFetch): add undici connection pooling to prevent connection exhaustion` | Potential throughput and connection-pressure improvement for `proxyFetch`. | After merge, require a load test before adoption. |
