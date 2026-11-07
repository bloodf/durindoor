# Manual two-upstream intake

Issue [#1148](https://github.com/bloodf/durindoor/issues/1148) adds a local report builder for `decolua/9router` and `diegosouzapw/OmniRoute`. It makes no network requests, creates no tickets, and changes no workflow or schedule. Existing three-argument `upstream-scan-report.sh` callers retain their existing behavior.

Prepare a JSON array of reviewed candidates. Each record accepts `source`, `number` for a PR or issue, `sha` for a commit pin, `title`, `state`, `finalDiff`, `localEquivalent`, `test`, `disposition`, `ownerIssue`, `why`, `additions`, `deletions`, and `author`. Example:

```json
[
  {
    "source": "diegosouzapw/OmniRoute",
    "sha": "8ed9da7165340",
    "title": "Review upstream commit",
    "state": "merged",
    "finalDiff": "https://github.com/diegosouzapw/OmniRoute/commit/8ed9da7165340",
    "localEquivalent": "none",
    "test": "none",
    "disposition": "needs-review",
    "ownerIssue": "#1148"
  }
]
```

This example is a review candidate, not an assertion that its concern is ported. Use existing upstream pins and verify the reachable final diff before deciding on a port. The helper preserves supplied SHA and diff references; it does not verify them against GitHub or local code.

```sh
node scripts/upstream-intake-ledger.mjs validate --candidates candidates.json
node scripts/upstream-intake-ledger.mjs dedup --candidates candidates.json --ported .github/upstream-ported.json --out reviewed.json
bash scripts/upstream-scan-report.sh --intake reviewed.json report .github/upstream-ported.json
```

Dispositions are `candidate`, `needs-review`, `tracked`, `deferred`, `skipped`, and `ported`. States are `open`, `merged`, `closed`, and `tracked`. Missing source defaults to 9router for legacy inputs; explicit null, empty, or unknown candidate sources fail validation. A candidate needs a positive safe integer number or a 7–40 character hexadecimal SHA. Prefer full SHAs. Abbreviated SHAs deduplicate only on exact normalized equality, never prefix matching. Numbered items use the repository's shared PR/issue number namespace. A commit-only record is not automatically conflated with a numbered PR carrying that SHA.

Titles never infer a port. An explicit `ported` candidate needs a local equivalent or reviewed rationale. This is a structural check, not independent approval. Review local implementation and tests before marking a candidate ported. Existing ledger membership is accepted as reviewed evidence. The ledger may be a legacy numeric array, an array of source-qualified objects using `pr`, `number`, or `sha`, or the repository's `{ "ported": [...] }` format. Only omitted ledger sources default to 9router. Explicit null/empty/unknown sources never hide candidates. The two upstream namespaces remain separate.

Duplicates retain the stronger disposition in this order: ported, tracked, deferred/skipped, needs-review, candidate. Equal precedence retains the first record. Additional non-default diff, equivalent, test, and owner evidence fills missing fields. Dedup output retains all records, including ports; reports omit ported records. Run `dedup` to store the normalized provenance ledger separately from the rendered report.

The report contains source, identifier, state, supplied SHA, diff, local equivalent/test, disposition and owner when present. Authors are omitted. Page one is `body.md`; later pages are `comment-002.md`, etc. `--page-bytes` on the Node CLI or the fourth intake positional argument sets the complete-page byte ceiling, including headers, between 512 and 65536, default 60000. UTF-8 bytes are counted. Oversized individual entries fail rather than truncate. Regeneration removes only numbered continuation Markdown files; other files, including input JSON, remain intact. A supplied missing ledger fails closed.

Affected offline checks are `unit/upstream-intake-ledger.test.js` and `unit/upstream-watch-filter.test.js`, run from `tests/` using its Vitest runner with `--maxWorkers=2`. Static checks are `node --check scripts/upstream-intake-ledger.mjs` and `bash -n scripts/upstream-scan-report.sh`. No app build input changes in this unit.
