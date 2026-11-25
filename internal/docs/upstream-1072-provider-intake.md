# Provider PR intake for #1072

Canonical intake workflow and current pointers: [upstream sync](./upstream-sync.mdx).

Reviewed against upstream PR state and diffs on 2026-11-20, at DurinDoor base `19373b3cbef1852fba507bfe3787000e10f0796c`. The rows below record the intake decisions and completed ports.

| PR | Finding |
| --- | --- |
| [#5742](https://github.com/decolua/9router/pull/5742) | Ported the per-connection Ultrafast toggle for GPT 6.2 Sol. It uses six times included usage and respects an explicit client tier. |
| [#5751](https://github.com/decolua/9router/pull/5751) | Ported Codex GPT 6.2 model metadata and removal of unsupported `uniqueItems` tool-schema constraints. |
| [#5770](https://github.com/decolua/9router/pull/5770) | Closed unmerged; not eligible. No open successor found by title search. |
| [#2314](https://github.com/decolua/9router/pull/2314) | Closed unmerged; not eligible. No open successor found by title search. |
| [#4935](https://github.com/decolua/9router/pull/4935) | Superseded by the fork's normalized evidence and provider-specific bounded reset policy in `src/sse/services/auth.js`; ordinary multi-hour resets are already supported. Removing the cap would change the deliberate low-frequency recheck safeguard. |
| [#5274](https://github.com/decolua/9router/pull/5274) | Closed unmerged; not eligible. No open successor found by title search. |
| [#5298](https://github.com/decolua/9router/pull/5298) | Deferred: too large (over 3,000 changed lines). |
| [#5313](https://github.com/decolua/9router/pull/5313) | Ported served-route response headers using DurinDoor header names. `DURINDOOR_ROUTE_HEADERS=0` or `false` disables them. Account identifiers are omitted. |
| [#5327](https://github.com/decolua/9router/pull/5327) | Not applicable: the `muse-web` executor addressed by the PR is absent from this fork. |
