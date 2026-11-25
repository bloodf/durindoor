# Port report: open PRs rows 601–640, port candidates 17–24

Source: [open-prs-nov25-16.md](open-prs-nov25-16.md). That report has 20 port-candidate rows, so candidates 17–20 are the only ones in this range. There are no candidates 21–24. On 2026-11-25 all four PRs were open, and each current head matched the head SHA in the source report.

| Row # | PR | Final disposition | Evidence |
|---:|---|---|---|
| 637 | [decolua/9router#2857](https://github.com/decolua/9router/pull/2857) | Ported in this change (adapted) | The runner stage of [Dockerfile](../../../Dockerfile) now removes Corepack and Yarn, and [GitLabAuthModal.js](../../../src/shared/components/GitLabAuthModal.js) uses a masked token placeholder. `npm` and `npx` stay: [MCP stdio instances](../../../docs/features/mcp-gateway.mdx) run `npx` on the gateway host. Upstream's `postcss` and `sharp` overrides are already met: [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) sets higher floors, and [pnpm-lock.yaml](../../../pnpm-lock.yaml) resolves only `postcss` 8.5.28 and `sharp` 0.35.5. Test: [port-2857-docker-image-scan-findings.test.js](../../../tests/unit/port-2857-docker-image-scan-findings.test.js). |
| 638 | [decolua/9router#2853](https://github.com/decolua/9router/pull/2853) | Ported in this change (remaining gap) | Commit `a747d618f74` (#447) had added the duration from `limit_window_seconds`. The current head also reads `window_seconds` and `windowSeconds`. [codexQuotaWindow.js](../../../open-sse/shared/codexQuotaWindow.js) now reads both. Its result supplies the duration and the weekly label to [usage/codex.js](../../../open-sse/services/usage/codex.js) and [the quota normalizer](../../../open-sse/services/quota/providers/codex.js). Test: [port-2853-codex-usage-windows.test.js](../../../tests/unit/port-2853-codex-usage-windows.test.js). |
| 639 | [decolua/9router#2850](https://github.com/decolua/9router/pull/2850) | Ported in this change (adapted) | [quotaAutoPing.js](../../../src/shared/services/quotaAutoPing.js) dropped a Claude session that reported no reset time unless an anchored slot or an earlier pending reset applied. With the reactive opt-in, it now starts that window. The conditions are a fresh weekly row, no exhausted weekly row of any scope, an available selected proxy pool, and no successful ping in five hours. The existing blocking-window and final re-read checks also apply. Test: the `port-2850` block in [quota-auto-ping.test.js](../../../tests/unit/quota-auto-ping.test.js). |
| 640 | [decolua/9router#2849](https://github.com/decolua/9router/pull/2849) | Already present | Commit `48f5bd253d3` (#446). [claude.js](../../../open-sse/providers/registry/claude.js) uses the shared CLI headers from [shared.js](../../../open-sse/providers/shared.js), which also supplies the billing version used by [claudeCloaking.js](../../../open-sse/utils/claudeCloaking.js). [default.js](../../../open-sse/executors/default.js) sends `X-Claude-Code-Session-Id` for `claude` only, and skips generated IDs. [sessionManager.js](../../../open-sse/utils/sessionManager.js) leaves the `claude` scope ID unprefixed. The local pins are newer than upstream's: CLI 2.1.312 and SDK 0.128.0, against 2.1.220 and 0.94.0. The beta list also comes from a later capture. Test: [claude-protocol-parity.test.js](../../../tests/unit/claude-protocol-parity.test.js). |

## How the #2850 port differs from upstream

- Upstream reads usage rows. DurinDoor reads quota snapshots, where an idle window is a fresh `requests:session` row with no reset time.
- Upstream adds an in-memory ping cache for a failed database write. DurinDoor already claims a marker before each paid request, so the idle start claims `lastPingAt`. A second process or a later tick sees that value.
- A rejected ping, or a thrown error that is not an abort, releases the claim. The existing 15-minute failure cooldown then applies. A timeout or other abort keeps the claim, so the idle start waits five hours.
- The failed-response cancel and the response read before saving were already present.
- The proxy check leaves OAuth routing modes to [connectionProxy.js](../../../src/lib/network/connectionProxy.js). `direct` and `legacy` ignore the pool ID, and a failed `strict-pool` returns an error that blocks the idle start. A resolver error blocks it in every mode.
- As upstream, the proxy check covers the idle start only. Reset and slot pings keep their routing.
- The behaviour is documented in [quota-tracking.mdx](../../../docs/features/quota-tracking.mdx#auto-ping). It adds no user setting.

## Limits

- #2857: the image was not built or scanned. The new test reads the Dockerfile text, the lockfile and the modal source. Findings in the dependencies bundled with `npm` remain, because `npm` stays.
- #2857: a custom MCP command in the container can no longer call Yarn or Corepack. [The Docker guide](../../../docs/deployment/docker.mdx) says so.
- #2850: no live Claude request was sent. The tests use a stubbed usage reader and transport.
