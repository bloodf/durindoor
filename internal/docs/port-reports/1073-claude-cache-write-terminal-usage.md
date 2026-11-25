# 1073: Claude terminal usage and cache-write aliases

Compared at DurinDoor base `48f23b85a4b7f999174fabe5bc4b03c3f2437e0d` on 2026-11-20.

## Source

- [OmniRoute #11814](https://github.com/cheaper-inference/OmniRoute/pull/11814), source `4d20d379740160ecebf46e67b2e57b5bb683f173`: adapted at `open-sse/utils/usageTracking.js`. The existing normalizer and canonicalizer accept top-level and token-detail `cache_write_tokens` as inclusive cache creation, retaining canonical-field precedence and stream aggregation. No accounting field or settlement path was added.
- [OmniRoute #14205](https://github.com/cheaper-inference/OmniRoute/pull/14205), source `844a34254abb38685bb2e89d2646dcda268a19fc`: adapted at `open-sse/translator/response/openai-to-claude.js`. Responses totals and details are read alongside numeric Chat Completions fields, including usage-only chunks; existing terminal emission timing is retained.
- Published regression: [bloodf/durindoor#2097](https://github.com/bloodf/durindoor/pull/2097) (`fix(gateway): harden remote image fetches and preserve stream output`), merged at `344ac6a6fd8142611a39a272e7d3b54769e4f60b`.

## Gap found

The shared usage normalizer already understood the `cache_write_tokens` alias, but the Claude-facing
stream terminal normalization did not. `toClaudeUsage()` in
`open-sse/translator/response/openai-to-claude.js` read the cache-write amount only from
`prompt_tokens_details.cache_creation_tokens` and `input_tokens_details.cache_creation_tokens`.
An upstream that reports its cache write under the `cache_write_tokens` spelling — top-level or
nested — had the write dropped from the Claude terminal receipt entirely.

Reproduced on an ordinary terminal usage of 12 inclusive input, 3 read-cache and 2 write-cache:
the Claude client received `input_tokens: 9` instead of `7`, and `cache_creation_input_tokens` was
omitted from the client-visible totals.

## Change

`open-sse/translator/response/openai-to-claude.js` now resolves the cache-write amount across the
same alias set the shared normalizer accepts, in canonical-first order:

    usage.cache_creation_input_tokens
      ?? usage.cache_write_tokens
      ?? usage.prompt_tokens_details.cache_creation_tokens
      ?? usage.prompt_tokens_details.cache_write_tokens
      ?? usage.input_tokens_details.cache_creation_tokens
      ?? usage.input_tokens_details.cache_write_tokens

The resolved value is then used by the existing Claude accounting, unchanged: the inclusive prompt
count is split into the uncached remainder (`input_tokens`), the cache-read portion
(`cache_read_input_tokens`) and the cache-write portion (`cache_creation_input_tokens`).

Semantics preserved:

- **Canonical precedence.** Canonical fields win over aliases, matching `normalizeUsage()`
  (`open-sse/utils/usageTracking.js`).
- **Explicit zero versus omission.** Nullish coalescing keeps a reported zero as "nothing was
  written" instead of falling through to a later alias, and an omitted field stays omitted. A
  zero cache write contributes no `cache_creation_input_tokens` key, exactly as before.
- **Inclusive total and idempotence.** The client-visible total stays inclusive
  (`input_tokens + cache_read_input_tokens + cache_creation_input_tokens` equals the reported
  prompt count) and a repeated pass over the same receipt does not shift it.
- **Standard translator behavior.** Usage-only chunks (no `choices`) still record the receipt
  without emitting terminal events; `message_delta` / `message_stop` emission, the finish guard,
  the flush-time finalization path and the existing canonical-spelling receipts are untouched.

Rejected alternatives:

- Routing the Claude receipt through `canonicalizeUsage()` would have changed the cache-exclusive
  versus cache-inclusive discriminator for this path and altered totals the client already sees.
- Reading the alias with a plain `||` would have collapsed an explicit zero into a fallback to a
  later alias, losing the zero-versus-omission distinction.

No timing, persistence, pricing, new feature or settlement change was made. The change is confined
to the Claude-facing stream terminal normalization of a usage receipt.

## Focused evidence

`tests/unit/omni-claude-cache-write-terminal-usage.test.js` covers the alias matrix (top-level
alias, nested canonical spelling, nested alias under either details object, top-level canonical
field), canonical precedence, explicit zero versus omission, inclusive-total idempotence, the
agreement with the shared normalizer, and the usage-only plus standard translator behavior.
Synthetic usage only; no provider call, browser, Docker, live request or paid API is involved.

The resolved cache-write amount was cross-checked against `normalizeUsage()` across the whole
alias matrix: the Claude terminal split resolves the same value as the shared normalizer for
every receipt, including the explicit-zero case (both resolve 0, leaving the prompt total
untouched) and the omitted case (both resolve 0 without a cache field).

Against the pre-change `toClaudeUsage()`, 7 of the 8 assertions fail; the one that passes is the
case that already used the supported canonical spelling. The existing
`tests/unit/omni-cache-write-usage-alias.test.js` and `tests/unit/openai-to-claude.test.js` keep
passing.

The wider `translator/` suite passes (92 files, 1816 tests, 0 failures; 9 files and 34 tests
skipped as pre-existing). ESLint on the changed files and the anti-slop gate over 2690 files
report no diagnostics.

The full `unit/` suite reports 1898 passing files and 20663 passing tests, with 10 failing
files: `antigravity-mitm-bypass`, `next-build-cpus`, `provider-detail-import-token`,
`provider-swap-priority`, `root-cli-advisories`, `visant-marketing-docs`,
`website-brand-canvas`, `website-demo-password`, `website-gate-geometry` and
`website-marquee-accessibility`. All 10 fail identically on the clean baseline with this change
stashed (same 4 assertion failures and same 8 collection errors), so they are pre-existing and
unrelated: they are website, dashboard and CLI build tests whose fixtures resolve paths relative
to a repository root that does not match this worktree layout. None of them touches the open-sse
translator path.

An earlier full-suite attempt on this host also failed at collection with `ENOSPC` while writing
Next.js SSR temp files: the shared `/tmp` tmpfs reached 100% inode usage (1048122 of 1048576
inodes, with 38G of free space). Those files were Next.js dashboard SSR tests unrelated to the
open-sse translator path, and they pass when re-run with the inode pressure relieved — the
condition was host-level, not caused by this change.
