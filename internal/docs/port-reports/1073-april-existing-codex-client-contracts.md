# #1073 April existing Codex client contracts

Scope: compare four pinned OmniRoute patches with the fork's current Codex request path and offline fixtures. This inventory covers existing Codex client request, header, and normalized input/output behavior. It does not propose client profiles, credentials, or sign-in edges.

## Pin and disposition inventory

| PR | Exact patch pin | Enclosing merge pin | Disposition |
| --- | --- | --- | --- |
| [OmniRoute #1709](https://github.com/cheaper-inference/OmniRoute/commit/0045d2c33a8dbb944ec0846bccb9986c74bcc116) | `0045d2c33a8dbb944ec0846bccb9986c74bcc116` | [8a0ca60e4b664c9b79e58519b37b54a4b8ca3aa6](https://github.com/cheaper-inference/OmniRoute/commit/8a0ca60e4b664c9b79e58519b37b54a4b8ca3aa6) | Covered by current translated/native instruction handling; no port gap. |
| [OmniRoute #1715](https://github.com/cheaper-inference/OmniRoute/commit/7187ccc245a209d7c011cf28f4d65d9812374c74) | `7187ccc245a209d7c011cf28f4d65d9812374c74` | [e6e7f8d402bfb5600c2580905b237521d62175c5](https://github.com/cheaper-inference/OmniRoute/commit/e6e7f8d402bfb5600c2580905b237521d62175c5) | Covered by current namespace and hosted-tool normalization; no port gap. |
| [OmniRoute #1777](https://github.com/cheaper-inference/OmniRoute/commit/cd4b386bb6df596cd01071f1feaae8ba60ed7475) | `cd4b386bb6df596cd01071f1feaae8ba60ed7475` | [33d4a89a4733e5da2553f16eb2474f53b978a640](https://github.com/cheaper-inference/OmniRoute/commit/33d4a89a4733e5da2553f16eb2474f53b978a640) | Covered by compact endpoint normalization and its unary body contract; no port gap. |
| [OmniRoute #1822](https://github.com/cheaper-inference/OmniRoute/commit/ff284b39ccf513618c930ba800b448b672fff927) | `ff284b39ccf513618c930ba800b448b672fff927` | [bc11f634ff6f5c1c28191b7394b8d3a3f0a88779](https://github.com/cheaper-inference/OmniRoute/commit/bc11f634ff6f5c1c28191b7394b8d3a3f0a88779) | Covered by current compact metadata stripping; no port gap. |

The #1709 and #1715 pinned heads are merge commits. Their relevant PR diffs are isolated against their first parents; unrelated release merge contents are excluded. For #1777 and #1822, the cited head commits are the named public diffs. The enclosing merges are recorded for provenance, not treated as patch scope.

## Current local contract and fixture evidence

### #1709 — instructions for bare chat

The patch adds a neutral `instructions` value for translated bare chat because the upstream Codex Responses service rejects the missing field. Its tool-capable translated requests retain the full Codex tool instructions. The current fork has an adjacent but narrower policy: `transformRequest` places translated chat system text into a developer message in the cacheable `input` prefix and sets top-level instructions to `You are a helpful assistant.`; native Responses instructions remain unchanged, and missing native instructions receive `CODEX_DEFAULT_INSTRUCTIONS`. This preserves explicit input and native-instruction semantics without adding the tool-instruction profile change.

Fixture: `tests/unit/codex-translated-instructions.test.js` checks translated system text becomes the developer input prefix, neutral top-level instructions, and preserved user input; its paired native case asserts the caller's instructions remain intact. No gap is demonstrated, so no new test or code change is indicated.

### #1715 — namespace MCP and hosted tools

The patch restores `namespace` tools, registers subtool names for `tool_choice` validation, and preserves a whitelist of hosted Responses tool types while dropping unknown hosted types. Current `normalizeCodexTools` keeps namespace objects and records their child names; it passes hosted types without function/name wrappers, keeps the separate `custom` passthrough, and retains the function normalization path. This keeps explicit tool selection valid without forwarding arbitrary unknown hosted types.

Fixture: `tests/unit/codex-tool-normalization.test.js` asserts namespace shape and hosted Responses tool preservation, including native `tool_search`; the Codex tool normalization tests cover filtering/normalization and schema handling. No gap is demonstrated, so no new test or code change is indicated.

### #1777 — `/responses/compact` request shape

The patch makes compact requests omit `store` even when storage is enabled, while regular `/responses` requests keep the existing explicit storage policy. Current request context selects the compact route, and `transformRequest` removes `stream` and `store` for compact requests while keeping ordinary Responses streaming enabled. Existing client headers are forwarded through the normal Codex header path; the compact endpoint uses its unary JSON accept behavior. The fork additionally strips `include` and `client_metadata` from compact bodies, as required by its narrower compact contract.

Fixtures: `tests/unit/codex-executor.test.js` checks compact routing, header forwarding, copy behavior, retries, and the compact body contract (`stream`, `store`, and `include` absent while supported fields remain). It also asserts `client_metadata` is absent for Responses Lite compact requests. The same file keeps regular streaming behavior covered. No gap is demonstrated, so no new test or code change is indicated.

### #1822 — compact client metadata

The patch removes caller-provided `client_metadata` and prevents generated Codex identity metadata from being applied on compact requests. The current compact request path strips client metadata after request normalization; identity resolution also skips compact requests, while standard Codex requests keep caller-copy and configured identity behavior.

Fixtures: `tests/unit/codex-executor.test.js` asserts compact `client_metadata` is absent in the actual outbound request. `tests/unit/codex-identity.test.js` checks compact requests do not create fingerprint identity, and `tests/unit/codex-fingerprint-execute.test.js` checks compact requests retain caller header identity while skipping generated fingerprinting. No gap is demonstrated, so no new test or code change is indicated.

## Preserved reasoning defaults

These patches do not justify changing reasoning normalization. The current Codex wire policy keeps an explicit `reasoning.effort` ahead of `reasoning_effort`, model suffix, and the existing low default; it normalizes supported values and retains the existing `summary: "auto"` behavior for non-Spark models. `reasoning.enabled: false` maps to `effort: "none"` only when the client supplied no explicit effort. `tests/unit/codex-client-version-and-reasoning.test.js` covers the whitelist, disabled mapping, and explicit-effort precedence; `tests/unit/codex-fast-capacity.test.js` covers normalized Codex effort and summary shape.

## Acceptance

No narrow behavior gap is demonstrated by these exact diffs against current source and fixtures. Therefore no additional acceptance test is proposed. The ordinary offline acceptance evidence is the existing focused fixture set named above; any future demonstrated gap should add a deterministic test under `tests/unit/` and preserve request-copy behavior, current narrow compatibility policies, and explicit reasoning defaults.
