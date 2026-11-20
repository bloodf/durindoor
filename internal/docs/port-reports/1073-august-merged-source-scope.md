# #1073 — August 2026 OmniRoute merged-source scope

Reviewed 2026-11-20 against the read-only source archive in [DurinDoor #1073](https://github.com/bloodf/durindoor/issues/1073) and the current local tree at `41975cce6`. This is a bounded source-scope audit, not an adjudication of all August changes and not a port selection list.

## Count and boundaries

The verified source query was `repo:cheaper-inference/OmniRoute is:pr is:merged merged:2026-08-01..2026-08-31`. Its reported total is **1,804**. To stay below GitHub's 1,000-result search cap, the month was partitioned into non-overlapping inclusive date windows:

| Inclusive merge dates (UTC) | Search total |
| --- | ---: |
| 2026-08-01..2026-08-07 | 352 |
| 2026-08-08..2026-08-14 | 405 |
| 2026-08-15..2026-08-21 | 432 |
| 2026-08-22..2026-08-28 | 451 |
| 2026-08-29..2026-08-31 | 164 |
| **Sum** | **1,804** |

All five date ranges are adjacent, non-overlapping, and cover the full month. Each range is far below the 1,000-result cap. The totals sum to the source query's 1,804; this is an upstream search count and does not use DurinDoor fork merges. Search results were paged to collect the 1,804 source PR numbers, then queried in batches of 20 through GraphQL for `mergedAt`, `mergeCommit.oid`, `changedFiles`, and `files(first:100){totalCount,nodes{path additions deletions}}`. All 1,804 returned a merge commit SHA. For 98 PRs, `changedFiles` exceeds the returned first 100 file nodes; those path lists are explicitly incomplete here. No row-level behavior disposition is inferred from that partial inventory.

The source archive describes itself as a 2026-10-08 collection snapshot (15,357 records / 8,409 merged PRs overall). Its domain and title labels are navigation aids, not scope decisions. The August source query is the independent count authority for this report.

## Scope rule

A path under `open-sse/` or `src/` is only a triage signal. Qualifying scope is an existing DurinDoor behavior: provider compatibility, protocol handling, or a security defense. Excluded are sign-in/auth flows, new providers, endpoints or integrations, new product features, workflows and changes that only reproduce a vulnerability. Titles and paths alone do not establish either a gap or coverage. A disposition requires reading the upstream patch and the local behavior; confirmed shipped behavior also needs an exact pre-existing local PR and local code evidence.

The bulk source result and GraphQL payloads are retained only in private mode-0700 disk scratch at `/tmp/durindoor-1073-aug-*`; they are not included in the repository. This report records a few source-qualified examples to guide further review, not a complete row-level disposition.

## Source-qualified examples

### Existing behavior already present: Ollama UTF-8 chunk decoding

OmniRoute [#11921](https://github.com/cheaper-inference/OmniRoute/pull/11921) merged 2026-08-30 at `41c6135257f8a61b53549978c881250c6de15227`. The patch adds a persistent `TextDecoder` and calls `decode(chunk, { stream: true })` in `open-sse/utils/ollamaTransform.ts`, preserving a multibyte code point split across byte chunks. DurinDoor already carries the same behavior in `open-sse/utils/ollamaTransform.js`: one decoder is created outside the chunk transform and streaming decode is used per chunk. This implementation is present in the earlier local Ollama NDJSON port [DurinDoor #271](https://github.com/bloodf/durindoor/pull/271), commit `566c00cdc`, and survives in the current source. Disposition: already covered; no August port gap established.

### Concrete existing-module candidate: cache-write usage alias

OmniRoute [#11814](https://github.com/cheaper-inference/OmniRoute/pull/11814) merged 2026-08-30 at `4d20d379740160ecebf46e67b2e57b5bb683f173`. Its final diff adds `cache_write_tokens` handling in usage normalization, translation, logging and accounting, including nested `prompt_tokens_details.cache_write_tokens`. This is a specific existing protocol/accounting path, not a new provider or feature.

Local comparison: `open-sse/utils/usageTracking.js` canonicalizes `cache_read_input_tokens`, `cache_creation_input_tokens`, `cached_tokens`, and nested `cache_creation_tokens`, but the current implementation does not recognize `cache_write_tokens` at the top level or under input details. The normalizer's preserved-field set likewise names `cache_creation_input_tokens`, not `cache_write_tokens`. This is a verified alias gap in the existing usage path; it does not establish the wider #11814 change as missing or justify copying its unrelated edits.

Acceptance evidence for a focused repair:

1. Normalize top-level `cache_write_tokens` to the canonical cache-creation field, and accept `input_tokens_details.cache_write_tokens` and `prompt_tokens_details.cache_write_tokens` at the same precedence as the corresponding existing cache-creation aliases.
2. Preserve the current distinction between a missing cache-write field and an explicitly reported zero; do not infer zero when the source omitted the field.
3. Keep cache-write tokens an inclusive subset of prompt tokens when the source usage format already reports inclusive prompt totals; do not add the amount to prompt twice during repeated normalization.
4. Carry the canonical value through the existing usage translation, stream aggregation and call-log accounting seams, with no change to cache-read, reasoning, completion or total-token semantics.
5. Add offline unit cases for top-level and both nested aliases, explicit zero, missing field, repeated normalization, and stream aggregation. Use synthetic usage objects only; no provider call is needed.

### Security path requiring a bounded applicability check, not a path-only verdict

OmniRoute [#11755](https://github.com/cheaper-inference/OmniRoute/pull/11755) merged 2026-08-30 at `faebf6de5f1f6e4c78c6281ffb175eea21821d95`. The patch makes the `block-metadata` remote-image guard explicitly call `parseAndValidateNonMetadataUrl` and adds synthetic tests for direct and redirect targets. DurinDoor has an existing SSRF guard in `src/shared/utils/ssrfGuard.js` that blocks the link-local range containing `169.254.169.254`, resolves hostnames, and revalidates each redirect in `fetchPublic`. That code is used by the existing `/v1/web/fetch` path (local security fix `0c7c9de00`, source code in `src/sse/handlers/fetch.js`). The paths and contracts are not identical, so this evidence closes only the web-fetch SSRF surface; it does not establish that every remote-image fetch caller uses an equivalent guard. Keep #11755 unresolved for a targeted call-site read rather than labeling it a gap or covered from filenames.

## Limits and next review boundary

This pass validates the month count and retrieves source-qualified metadata for all 1,804 PRs, but it does not classify every row. The GraphQL response requested the first 100 changed paths; 98 records have additional paths not represented in this summary. No claim of exhaustive path classification or exhaustive adjudication follows from the count. The examples above are patch-backed and keyed by exact merge SHA. Future row-level work should paginate changed-file connections for any candidate row before classifying it, then use the relevant local PR and source code for coverage; it should not select records from titles or the archive's suggested-area labels alone.

No runtime code, tests, provider, credential, workflow, baseline or owner communication was changed or used. GitHub access was limited to read-only source issue, search, GraphQL PR metadata and final-diff file metadata.

Refs #1073
