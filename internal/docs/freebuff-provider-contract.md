# Freebuff provider contract gap

Status: documentation only. DurinDoor issue [#1182](https://github.com/bloodf/durindoor/issues/1182) remains open pending an officially supported third-party Freebuff authentication and headless integration boundary. The tracking issue is [#2034](https://github.com/bloodf/durindoor/issues/2034). This note makes no route, product, credential, or issue-state change.

## Pinned evidence

The first-party source reviewed is CodebuffAI/freebuff at commit [`86cd5e186d0f99b9d63cac6960568d2210d76dae`](https://github.com/CodebuffAI/freebuff/tree/86cd5e186d0f99b9d63cac6960568d2210d76dae). Its [README](https://github.com/CodebuffAI/freebuff/blob/86cd5e186d0f99b9d63cac6960568d2210d76dae/README.md) describes Freebuff as a separate product with free, ad-supported access, a curated model catalog, tier-dependent limits and notices, and a CLI started interactively with `freebuff`. It says Freebuff is built on Codebuff and points to the Codebuff documentation and `@codebuff/sdk` for embedding Codebuff agents; that relationship does not document Freebuff credentials as Codebuff SDK credentials.

At that pin, `cli/src/cli-args.ts` builds distinct argument parsers. Freebuff accepts `--continue`, `--cwd`, `--trust-agents`, and the `login` or `doctor` command; it has no prompt argument or print/headless/JSON mode. The paid `codebuff` parser accepts prompt arguments and agent/mode options, but it also has no CLI print/headless mode. The separate `sdk/src/client.ts` provides programmatic `CodebuffClient.run()` and expects a Codebuff API key (`apiKey` or `CODEBUFF_API_KEY`). The SDK's print-mode event callback is an SDK capability, not a Freebuff CLI interface or proof that a Freebuff login token is accepted as an SDK key.

Freebuff's CLI login credential is a device-OAuth `authToken` associated with Freebuff credentials, not a paid `cb_...` Codebuff API key. The distinction, including the open request for Freebuff headless and SDK support, is recorded in [Freebuff issue #947](https://github.com/CodebuffAI/freebuff/issues/947). That issue is open and is evidence of a request, not a supported contract. No credentials, account state, or provider requests were used for this review.

## OmniRoute comparison

At OmniRoute `release/v3.8.55`, pinned to [`575c3d49c15b2ff444e39c83a6ee648f19a2923e`](https://github.com/cheaper-inference/OmniRoute/tree/575c3d49c15b2ff444e39c83a6ee648f19a2923e), the [`freebuff` registry entry](https://github.com/cheaper-inference/OmniRoute/blob/575c3d49c15b2ff444e39c83a6ee648f19a2923e/open-sse/config/providers/registry/freebuff/index.ts) registers `freebuff` / `fb`, OpenAI-format requests, API-key/Bearer credential handling, a fixed `www.codebuff.com/api/v1` base, and a static catalog. Its [specialized executor](https://github.com/cheaper-inference/OmniRoute/blob/575c3d49c15b2ff444e39c83a6ee648f19a2923e/open-sse/executors/freebuff.ts) takes `credentials.apiKey` or `credentials.accessToken`, sends it as a Bearer token, then directly sequences Freebuff session acquisition, agent-run start, chat completion, and background run completion. The executor map registers both `freebuff` and `fb` to that executor.

This is a composed client implementation against service endpoints, not evidence that Freebuff officially supports third-party orchestrators, documents those endpoints as an integration API, or guarantees that a device-OAuth token can be used there. Its generic API-key slot does not make the Freebuff token equivalent to the separate paid Codebuff SDK key. DurinDoor must preserve the existing paid Codebuff connection and its credential contract; Freebuff must remain a separately maintained product identity with its own explicit auth and runtime contract if official support becomes available.

## Acceptance for a future supported integration

Do not implement or advertise the Freebuff route until Freebuff documents or approves a third-party auth and headless/SDK boundary, including the credential type, permitted use, lifecycle/revocation, required fingerprint or device binding, session/usage/ad enforcement, and structured errors. The integration must use that supported boundary and keep Freebuff credentials isolated from the paid Codebuff connection.

Offline acceptance must use only injected fake transports and synthetic credentials. Tests must demonstrate:

1. Official Freebuff auth acquisition/configuration, credential refresh or reauthentication, revocation/status behavior, and rejection of invalid or expired credentials without reading stored account credentials.
2. A documented headless/SDK request and event contract, including prompt/session continuation, output and tool-event mapping, cancellation, and structured auth, quota/session-limit, model-unavailable, and upstream errors.
3. Freebuff-specific model/agent selection and session ordering, plus any required ad, notice, and usage-limit handling, matching the supported contract.
4. Separation from the existing Codebuff paid connection: paid `CODEBUFF_API_KEY` configuration and behavior remain intact; a Freebuff device token is never silently treated as a paid Codebuff SDK key or saved into that connection.
5. Strictly offline execution: assert every request against the fake transport and fail if any real network access is attempted. No installed Freebuff/Codebuff CLI, real provider request, or stored key is needed to run these tests.

This document names the prospective public contract precisely: **Freebuff third-party authentication and headless execution integration**. It does not claim that `freebuff` is currently a supported DurinDoor provider or alter the existing **paid Codebuff API-key connection**.
