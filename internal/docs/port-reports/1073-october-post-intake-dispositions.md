# #1073 October OmniRoute post-intake dispositions

## Reconciled inventory

The fixed source query is `repo:cheaper-inference/OmniRoute is:pr is:merged merged:2026-10-07..2026-10-31`: **1,692** unique merged pull requests. It was re-queried on 2026-11-20 in three non-overlapping GraphQL date shards (Oct 7–15: 665; Oct 16–23: 597; Oct 24–31: 430), each below GitHub's 1,000-result search ceiling. Full PR metadata is retained privately at `/tmp/omni-oct-2026-10-07-31.json`, not in the repository.

The original survey in [#1073 comment 7022650314](https://github.com/bloodf/durindoor/issues/1073#issuecomment-7022650314) and [comment 7022651366](https://github.com/bloodf/durindoor/issues/1073#issuecomment-7022651366) counted 1,872 merges for Oct 6–31. It explicitly used title and diff-stat triage and did not read diffs. The 180-record difference is the removed Oct 6 date shard; the old grouped recommendations are not applicability verdicts. This reconciliation does not claim diff-level review of all 1,692 records. It uses the refreshed complete metadata inventory to anchor the scope, then reconciles source-qualified decisions recorded in later #1073 comments, published DurinDoor PRs, and the focused reports below.

## Dispositions reconciled to current main

The current #1073 comments document source-level ports and exceptions through DurinDoor #2088. Current `origin/main` is `9987f21b3e555b55bf9a443ef18667d40dec52f9`, DurinDoor #2089, which adds the combo refusal and single-account relay recovery port. Published port batches preserve prior work; this report does not reopen or replace it. Focused evidence and offline acceptance are recorded in:

- [protocol and tool-schema dispositions](1073-tool-schema-and-error-classification.md) and [Responses/native-content dispositions](1073-responses-text-and-native-content.md);
- [event-stream boundaries](1073-event-stream-boundaries.md) and [empty-stream terminal ordering](1073-empty-stream-terminal.md);
- [provider request residuals](1073-existing-provider-request-residuals.md);
- [search credential destination policy](1073-search-credential-destination.md), [image-edit compatibility](1073-image-edit-compatibility.md), and [stream metadata redaction](1073-stream-metadata-redaction.md).

These records cover the targeted protocol preservation, defensive security and existing-provider corrections that were verified against local modules and accepted offline tests. Their dispositions distinguish already covered behavior, completed ports, partial adaptations, inapplicable upstream machinery, and excluded product scope. The recent #1073 comments also record source-linked PR batches #2060–#2088 and their focused gate results; #2089 is visible in current local history.

## Residuals and boundary

No additional, verifiable in-scope missing fix was established in the reviewed existing protocol, defensive-security, or provider-correction paths after the current-tree follow-ups. The following cited upstream residuals remain explicitly unported, with local evidence explaining why they do not constitute a missing compatible fix:

- OmniRoute [#19403](https://github.com/cheaper-inference/OmniRoute/pull/19403), current head `b8705ef21a1cf8b52d9f396a7e0fb6bb08db2056`: the non-streaming unsigned Claude thinking-block change conflicts with the established local response shape and compatibility assertions. The compatible translated streaming portion is already adapted in `open-sse/translator/response/openai-to-claude.js` and `gemini-to-claude.js`; retain the focused translator acceptance recorded in `1073-responses-text-and-native-content.md`.
- OmniRoute [#20095](https://github.com/cheaper-inference/OmniRoute/pull/20095), current head `db8e10356cd05cd247893ce5e898ff393054cef1`: it enables a generic retry loop that DurinDoor does not have. The local Antigravity-specific policy remains in `open-sse/handlers/chatCore/emptyStreamGuard.js`; `tests/unit/empty-stream-guard.test.js` is the offline acceptance for that existing policy. Adding generic retries is not a correction to an existing compatible path.
- OmniRoute [#20508](https://github.com/cheaper-inference/OmniRoute/pull/20508), current head `4f40b84923719ce1c8c8fa6c2f9c7a96d297d065`: the upstream shared-buffer corruption path is absent. Local visible-content masking and request-detail redaction have distinct contracts in `open-sse/services/responseMasking.js`, `open-sse/utils/requestLogger.js`, and `src/app/api/usage/request-details/route.js`; a new metadata-masking policy is not established by that upstream fix. See `1073-stream-metadata-redaction.md`.

New providers, features, endpoints, integrations, and sign-in/auth flows remain with their designated scope. No selection slate is proposed.
