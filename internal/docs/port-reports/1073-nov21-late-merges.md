# #1073 disposition: OmniRoute late merges of 2026-11-21

Static review of the two OmniRoute PRs merged after 17:55 UTC. Each source is pinned to its exact PR head SHA. No upstream code was executed.

| Source PR | Pinned head | Disposition |
| --- | --- | --- |
| [#20961: restore preferred-account failover wiring](https://github.com/cheaper-inference/OmniRoute/pull/20961) | [`7b7b61c6e771a17a35bdc829dbaa624404dadd76`](https://github.com/cheaper-inference/OmniRoute/commit/7b7b61c6e771a17a35bdc829dbaa624404dadd76) | **port** — DurinDoor's existing single-model chat retry loop in [`src/sse/handlers/chat.js`](../../../src/sse/handlers/chat.js) selects preferred connections and supports sibling retry, but has no preferred-account response-start deadline or request-scoped-timeout branch. Add the wiring in `handleSingleModelChat` and its dispatch path. Acceptance: when the Resilience preference is enabled for an eligible preferred API-key account, apply the configured shorter response-start deadline only when an eligible sibling exists; on that request-scoped timeout, exclude the preferred account and make at most one sibling attempt, preserving the original timeout if no sibling can serve. Keep the feature disabled for explicit pins, managed leases, Muse callers, combos, client aborts, and after the single hop; do not cool either account for this routing hint. Reuse DurinDoor's current settings and failover policy, and preserve ordinary retry behavior. Add focused offline tests in `tests/unit/` for enabled preferred-to-sibling recovery, disabled setting, no sibling/original timeout, pin and combo exclusions, client abort, one-hop bound, and no cooldown. |
| [#20370: plugin model limits and free marker](https://github.com/cheaper-inference/OmniRoute/pull/20370) | [`3ab4719c0769040016b50e1f8a419eb192508d64`](https://github.com/cheaper-inference/OmniRoute/commit/3ab4719c0769040016b50e1f8a419eb192508d64) | **out of scope** — the changes are confined to OmniRoute's `@omniroute/opencode-plugin-v2` integration: model-row output limits, free quota/display labels, free-signal option warnings, and its plugin tests/docs. DurinDoor has no corresponding OpenCode plugin component to improve. |

## Evidence

- No existing disposition for either PR was found under `internal/docs/port-reports/` or `docs/`.
- #20961 restores a shortened preferred-account response-start timeout and one sibling retry in upstream `src/sse/handlers/chat.ts`. DurinDoor's `handleSingleModelChat` in [`src/sse/handlers/chat.js`](../../../src/sse/handlers/chat.js) already selects preferred connections and handles other retry cases, but its loop lacks that timeout policy. The earlier 9router #2068 port established distinct single-account relay recovery behavior; it does not implement preferred-account response-start failover.
- #20370's changed runtime and test paths are under `@omniroute/opencode-plugin-v2/`; no matching plugin package or model-row implementation exists in this repository.

