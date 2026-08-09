# Upstream + OmniRoute Sync Ledger — 2026-08-09

Scope: `decolua/9router` commits `6fcd27337..15223724c` (42 commits), `diegosouzapw/OmniRoute` commits `16ed70714..918fba5e3` (5 commits), the DurinDoor model-catalog audit, and the context-handling repair. Source anchors and unmerged watches live in [`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

## Workstream B — Model catalog

| Item | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| Kiro Claude Opus 4.7/4.8 agentic variants | FIXED | `open-sse/providers/registry/kiro.js` exposes `claude-opus-4.7[-thinking]-agentic` and `claude-opus-4.8[-thinking]-agentic`, but `MODEL_CAPABILITIES` covered base/thinking only and `PATTERN_CAPABILITIES` matched dot ids without limits. Dot forms resolved 200000/64000; dash forms additionally fell to the generic `*claude*opus*` `claude-budget` row. | Added eight exact `MODEL_CAPABILITIES` rows (dot + dash) carrying the 1000000/128000 `claude-adaptive` contract. Regression test in `tests/unit/capabilities.test.js`. |
| MiniMax M3 native context window | FIXED | `platform.minimax.io` documents a 1,000,000-token window with a 131,072 recommended output cap and a guaranteed 512K minimum; DurinDoor resolved native `minimax` / `minimax-cn` through the conservative `*minimax-m3*` 512000 pattern. | Added `MINIMAX_M3_NATIVE_CAPS` as a `PROVIDER_CAPABILITIES` override for the two native providers only. Third-party hosts (Fireworks, NIM, OpenRouter-style) keep their guaranteed floors. Regression test in `tests/unit/capabilities-opus-context.test.js`. |
| Direct OpenAI GPT-5.4 context window | FIXED | `developers.openai.com/api/docs/models/gpt-5.4` reprices >272K input prompts for "models with a 1.05M context window"; DurinDoor resolved `gpt-5.4` through the generic `*gpt-5*` 400000 pattern. | Added `gpt-5.4` to `DIRECT_GPT_5_5_6_CAPS` and the Codex-only `gpt-5.4-review` alias (registry `codex.js` sets `upstreamModelId: "gpt-5.4"`). Mini/nano tiers deliberately keep the 400K pattern. Regression test in `tests/unit/capabilities.test.js`. |
| `gpt-5.4-pro` | NOT APPLICABLE | Neither `registry/openai.js` nor `registry/codex.js` exposes the id; only third-party hosts (`blackbox.js`, `chatgpt-web.js`) list it, and their windows are not first-party verified. | No row added — avoids asserting a limit for an id this fork does not serve directly. |
| GPT-5.5/5.6, Claude 5, Kimi K3 limits (closed PR #397) | DUPLICATE | Already present on `main`: GPT-5.5/5.6 and Codex aliases at 1050000/128000, `claude-opus-5`/`claude-sonnet-5` at 1000000/128000, `kimi-k3` at 1048576/262144. | No change; verified by direct resolver query. |
| `MiniMax-M2.7-highspeed`, `claude-fable-5` | DUPLICATE | Exact pattern rows already present and correct (204800 and 1000000 respectively). | No change, per plan instruction not to touch confirmed rows. |
| Missing Anthropic/Claude-OAuth model candidates from OmniRoute registry | DEFERRED | Candidate ids (`claude-opus-4.5/4.6/4.7/4.8`, `claude-sonnet-4.5/4.6`, dated OAuth ids) require per-model live availability verification; transport and account catalogs differ and several are historical. | No bulk port, per plan. Revisit per model with provider evidence. |
| Codex GPT-5.6 "missing" rows in the committed catalog report | NOT APPLICABLE | Current `registry/codex.js` already contains the Sol/Terra/Luna families plus review variants at 1050000/128000; the report rows are stale. | No action. |
| Reasoning deny-list comparison | DEFERRED | Upstream raw `modelCapabilities.js` returns 404, so no upstream equivalent exists to diff against. | Local deny-list retained unchanged. |

## Verification

- `cd tests && npm run test:ci`: `Raw failures: 0`, `Known failures still failing: 0`, `Stale baseline entries now passing: 0` (6328 tests, 6268 passed, 0 failed).
- `npm run lint`: exit 0, pre-existing warnings only (0 errors).
- Each catalog fix was proven load-bearing by reverting the source file and confirming the new test turns red.

### Environment note

`tests/node_modules`'s `better-sqlite3` native binding was compiled for NODE_MODULE_VERSION 115 (Node 20) while the workstation runs Node 24 (ABI 137), which failed 14 DB-backed suites on a clean `origin/main` checkout before any edit. Rebuilt the binding for the active runtime (`npx prebuild-install -r node -t 24.19.0` inside `node_modules/better-sqlite3`; the package's install script is blocked by the repo's `allowScripts` policy, so `npm rebuild` is a no-op). This is a local toolchain repair only — no repository file changed.
