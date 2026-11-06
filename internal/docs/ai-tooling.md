# Agent tooling

Product development remains HOLD until the user explicitly resumes it. Completing tooling does not resume product work.

The repository-only [preparation plan](ai-tooling-plan.md) records rollout steps and preserved product work.

## Reproducible installation

Reviewed release: `1.6.2`. Upstream source inspected at `f72c9d2efb14454ff4f9fd7b8460abd82f19a287`; that source is newer than the release, so use installed CLI help for flags.

Download `https://raw.githubusercontent.com/colbymchenry/codegraph/f72c9d2efb14454ff4f9fd7b8460abd82f19a287/install.sh`, inspect it, then run with `CODEGRAPH_VERSION=v1.6.2 sh <downloaded-file>`. This installs the standalone macOS/Linux bundle under `~/.codegraph/versions/v1.6.2` and `~/.local/bin/codegraph`; it needs `curl` and `tar`, not the project's Node dependency graph. Do not automatically upgrade during feature work.

## Commands

Run from the repository root:

```sh
sh scripts/codegraph.sh init --yes
sh scripts/codegraph.sh sync
sh scripts/codegraph.sh status --json
sh scripts/codegraph.sh query '<known project symbol>' --limit 5 --json
sh scripts/codegraph.sh explore --max-files 3 '<narrow question or symbol names>'
```

`init` creates and indexes `.codegraph/`; `.codegraph/.gitignore` is tracked and excludes the database, sockets, logs and daemon state. Never commit those data files or copy indexes between worktrees. Each worktree needs its own index, generated from that worktree's source.

For ownership and dependency questions, query the graph before broad recursive file reads. Start with 1–3 source files; widen only if the answer is missing. Use ordinary bounded search for exact text, unsupported syntax or missing graph results, and inspect changed lines directly before editing. The graph is retrieval assistance, not proof of runtime behavior or complete dynamic call coverage.

The MCP service watches changes only while it is active. The CLI-only route requires explicit `sync` after checkout or edits. Re-run `index` after changing `codegraph.json` include/exclude/extension rules. Inspect `status --json` for pending changes and index completion; the installed 1.6.2 release does not expose `--strict` despite the current upstream docs describing it. Retain a clean tracked checkout for exact-head verification.

The installed CLI supports `install --target codex,cursor,antigravity --location global --yes`; that writes user-specific harness configs and belongs in workstation setup, not in a repository PR. Keep MCP tool exposure at its default single `codegraph_explore` tool. Grok/MiniMax can use the same bounded CLI commands when MCP is unavailable.

No local token or cost reduction has been measured yet. Upstream benchmarks do not establish savings for these projects. Dense graph responses can increase resident session context, so limit queries and outputs.

## Harnesses and token tools

CodeGraph MCP is available only where the central workstation setup configured it. Use the CLI wrapper otherwise, including Grok and MiniMax. Global installation and harness settings belong to the central coordinator; repository tasks must not edit them.

RTK: honor `~/.codex/RTK.md`. With active output hooks, run ordinary commands and never compress twice. Without a hook, use supported explicit RTK CLI commands. Use `rtk bypass` only when compressed output is unusable. Retain raw gate evidence outside the repository.

Caveman: concise human-readable progress without dropping constraints, failures or evidence. Ponytail: reuse existing helpers and standard tools; choose the smallest sufficient change. Both are skills or manual working conventions, not runtime dependencies. Use the installed skill when the harness exposes it; otherwise follow these conventions without claiming native integration.

TokenEconomizer: central ownership covers installation and settings. Where supported, it supplies repository learning, tool pruning and loop guidance. It is not a generic output compressor. No native support is assumed for unsupported harnesses; use manual guidance and keep required orchestration, review and device tools available.

## Model policy

Antigravity uses Google models only. Reserve an account with the central coordinator before launching; one worker per account globally. Keep quota-exhausted Argon parked. Use only exposed provider/model identifiers, never inferred quotas or blind retry loops.

Prefer available MiniMax M3.1 Flash for bounded mechanical tasks. Use thinking/frontier models for judgment and independent risky review. The coordinator owns global routing and quota reservations.

All existing contributor, independent review, security, test and merge gates remain mandatory. Graph results and token savings claims do not replace checks.
