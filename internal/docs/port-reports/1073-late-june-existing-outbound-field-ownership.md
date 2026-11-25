# #1073 Late June: existing outbound field ownership

## Scope and pins

This review compares the three exact OmniRoute PR heads. Each supplied enclosing merge includes release integration context, so the PR-head commits are the change boundary used here; the enclosing merge pins are recorded for provenance, not treated as isolated patches.

| PR | Exact patch head | Enclosing merge | Public patch |
| --- | --- | --- | --- |
| [#4658](https://github.com/cheaper-inference/OmniRoute/pull/4658) | `bf7a31d6572656670c91a5a1bf5f8c99b9a2ed30` | `607ad12e842cd021f9cb0a1107d4b2fd280eed41` | [head commit](https://github.com/cheaper-inference/OmniRoute/commit/bf7a31d6572656670c91a5a1bf5f8c99b9a2ed30) |
| [#4727](https://github.com/cheaper-inference/OmniRoute/pull/4727) | `cd568bbc7576ad144ce832d29320fa28676c428b` | `7bda901ce74892279968ff03fb0ff82a9e5b0b62` | [head commit](https://github.com/cheaper-inference/OmniRoute/commit/cd568bbc7576ad144ce832d29320fa28676c428b) |
| [#4820](https://github.com/cheaper-inference/OmniRoute/pull/4820) | `dd3045a961b32188a49e41a3399082295e56d4ec` | `7ff7af585b275e61672e595c6081bbe359c6ee89` | [head commit](https://github.com/cheaper-inference/OmniRoute/commit/dd3045a961b32188a49e41a3399082295e56d4ec) |

## Current outbound ownership and fixture evidence

DurinDoor's default executor applies parameter rules at the final outbound transformation boundary in [`default.js`](../../../open-sse/executors/default.js). [`paramSupport.js`](../../../open-sse/translator/concerns/paramSupport.js) keeps rules scoped by provider/model where the observed contract is specific. It already drops `temperature` for Claude models and for GitHub Copilot's supported GPT-5.4+ / GPT-6 model spellings, and drops GitHub Claude `thinking` plus `reasoning_effort` except the Opus/Sonnet 4.6 cases. These cover #4658's narrower Claude Opus 4, GitHub GPT-5.4, and GitHub Claude rules. Offline examples and negative controls are in [`param-support.test.js`](../../../tests/unit/param-support.test.js): Claude temperature with unrelated-field preservation, GitHub model-range allow/deny cases, Claude reasoning exceptions, and non-GitHub preservation.

For #4727, the default executor removes `client_metadata` only when its selected transport config declares `quirks.dropClientMetadata`. The Cerebras and Mistral registry entries both declare that quirk ([Cerebras](../../../open-sse/providers/registry/cerebras.js), [Mistral](../../../open-sse/providers/registry/mistral.js)); OpenAI's config does not acquire a global strip. This keeps Codex/OpenAI metadata owned by the caller path while omitting it on the two named transports. Existing offline fixtures verify Codex metadata construction and preservation ([`codex-identity.test.js`](../../../tests/unit/codex-identity.test.js), [`codex-fingerprint-execute.test.js`](../../../tests/unit/codex-fingerprint-execute.test.js)); the targeted Cerebras/Mistral transport quirk is implemented, though the current unit suite has no direct transform assertion for that exact pair. The public PR's fixture supplies the appropriate acceptance shape: strip on Cerebras and Mistral, preserve on OpenAI.

Header construction is adapter-owned: [`BaseExecutor.buildHeaders`](../../../open-sse/executors/base.js) starts with configured headers and auth, while callers can supply select headers through request context to provider-specific code. Claude's adapter deliberately emits Stainless headers; current offline assertions preserve those headers in [`claude-protocol-parity.test.js`](../../../tests/unit/claude-protocol-parity.test.js). The base outbound loop applies the resulting provider headers without a generic Stainless filter. No local fixture documents a particular OpenAI-compatible provider rejecting these fields.

## Dispositions

### OmniRoute #4658 — already covered; no port

The commit adds parameter stripping in OmniRoute's default/GitHub executors using a generic rule table. DurinDoor already runs the equivalent narrow rules at the outbound boundary, and its offline tests exercise the targeted model/provider cases plus preservation cases. Do not add duplicate rules or broaden them to unrelated providers/models. No demonstrated behavior gap remains.

### OmniRoute #4727 — behavior already present; add ordinary offline acceptance for the exact transport pair

The commit strips `client_metadata` for Cerebras and Mistral while retaining it for OpenAI. DurinDoor's per-transport `dropClientMetadata` quirk already expresses that exact scope. The remaining evidence gap is a direct offline transform fixture for these two configured transports. Ordinary acceptance should add a focused unit case invoking `DefaultExecutor.transformRequest` with `client_metadata` for Cerebras and Mistral and asserting removal, plus an OpenAI control asserting the value survives. This does not require live provider calls or a generic strip.

### OmniRoute #4820 — do not port

The commit strips all `X-Stainless-*` headers for any matching OpenAI-compatible endpoint and rewrites selected SDK-derived User-Agent values. Its fixture demonstrates helper behavior, but does not establish a provider-specific rejection contract for DurinDoor's configured adapters. A blanket endpoint predicate could remove adapter-configured metadata without evidence, and User-Agent rewriting changes caller/provider fingerprint behavior. Keep existing caller header ownership and adapter-specific header construction; make no auth or fingerprint changes.

## Result

No product change is warranted from these patches. #4658 is covered, #4727's behavior is implemented with a small offline fixture gap, and #4820 is not supported by provider-scoped source evidence under this review's constraints.
