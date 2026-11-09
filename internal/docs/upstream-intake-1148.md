# Upstream Intake and Provenance Ledger (Issue #1148)

Tracking and intake design for upstream candidates across `decolua/9router` and `diegosouzapw/OmniRoute`.

Reference Issue: [bloodf/durindoor#1148](https://github.com/bloodf/durindoor/issues/1148)  
Parent Epic: [bloodf/durindoor#1068](https://github.com/bloodf/durindoor/issues/1068)  
Roadmap: [bloodf/durindoor#1056](https://github.com/bloodf/durindoor/issues/1056)

---

## 1. Outcome and Motivation

The baseline scan (`scripts/upstream-scan-report.sh`) provided single-repository dispatch scanning for open pull requests from `decolua/9router`. Issue #1148 extends intake architecture to:

1. **Dual Upstreams**: Track candidates from both primary upstream `decolua/9router` and secondary upstream `diegosouzapw/OmniRoute`.
2. **Comprehensive Ingestion**: Ingest open PRs, merged direct commits, and tracking issues.
3. **Reviewed Record Schema**: Record source SHA, upstream state, final diff reference, local fork equivalent, test coverage, explicit disposition, and owner issue.
4. **Strict Provenance Guarantee**: Titles must never be parsed to infer ported status. Only verified local code or reviewed ledger entries justify a `ported` disposition.
5. **Deduplication and GitHub Caps**: Composite key deduplication prevents cross-source collisions (e.g. 9router #42 vs OmniRoute #42), and deterministic chunking ensures every report file strictly respects GitHub's 65,536-byte issue/comment limit.
6. **Preserved Manual Dispatch**: Scans remain manual (`workflow_dispatch`); automated watchers, cron schedules, or silent bot ticket spam are prohibited.

---

## 2. Candidate Record Schema

Candidate entries in the intake ledger (`scripts/upstream-intake-ledger.mjs`) adhere to the following schema:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `source` | `string` | Yes | Source repository: `"decolua/9router"` or `"diegosouzapw/OmniRoute"`. |
| `sha` | `string` \| `null` | Semi | Upstream commit SHA (40-char full or >=7-char short SHA). Required for commits. |
| `number` | `number` \| `null` | Semi | Upstream PR or issue number. Required for PRs. |
| `title` | `string` | Yes | Upstream pull request title or commit subject. |
| `state` | `string` | Yes | Upstream state: `"open"`, `"merged"`, `"closed"`, or `"tracked"`. |
| `finalDiff` | `string` | Yes | URL, patch reference, diff hash, or `"pending"` for unmerged candidates. |
| `localEquivalent` | `string` | Yes | Fork file/module path implementing the concern, or `"none"`. |
| `test` | `string` | Yes | Local test file path covering behavior, or `"none"`. |
| `disposition` | `string` | Yes | Reviewed decision: `candidate`, `needs-review`, `tracked`, `deferred`, `skipped`, `ported`. |
| `ownerIssue` | `string` \| `null` | No | DurinDoor tracking issue (e.g. `"#1148"`, `"#1068"`, `"#1355"`). |
| `additions` | `number` | No | Number of line additions in candidate diff. |
| `deletions` | `number` | No | Number of line deletions in candidate diff. |
| `why` | `string` | No | Rationale for disposition or required port trigger. |
| `author` | `string` | No | Upstream author username (stored internally, omitted from public markdown bullets). |

### Disposition Lifecycle

- **`candidate`**: Freshly scanned or ingested upstream item awaiting maintainer review.
- **`needs-review`**: Flagged for technical review or port trigger evaluation.
- **`tracked`**: Formally adopted into roadmap/epic under an owner issue, awaiting port PR.
- **`deferred`**: Explicitly postponed with recorded trigger (e.g., waiting for upstream merge, demand, or dependency).
- **`skipped`**: Explicitly evaluated and rejected (e.g., release/branding bump, incompatible design).
- **`ported`**: Implemented, tested, and merged into DurinDoor with verified local equivalent and test evidence.

---

## 3. Core Invariants

### 3.1 Title Port Invariant
> **Rule**: An upstream PR or commit title such as `port(upstream): #4482` or `feat: port token saver` must **never** cause the scanner to infer `disposition: "ported"`.

Upstream titles describe upstream work, not DurinDoor work. Marking an item `ported` requires verified evidence in DurinDoor: a matching entry in `.github/upstream-ported.json`, an active local commit subject, or explicit maintainer review.

### 3.2 Multi-Source Isolation
> **Rule**: Canonical identifiers are strictly source-qualified: `${source}#PR${number}` or `${source}#SHA${sha}`.

PR #42 in `decolua/9router` and PR #42 in `diegosouzapw/OmniRoute` are entirely unrelated. The ledger keeps distinct namespaces to eliminate accidental cross-repository deduplication.

### 3.3 Body Limits and Pagination
> **Rule**: GitHub caps issue bodies and comments at 65,536 bytes. No candidate may be silently dropped or truncated.

- Safe page ceiling: `PAGE_BYTES=60000` (leaving headroom for headers and footers).
- Page 1 is written to `body.md`.
- Continuation pages are written to `comment-002.md`, `comment-003.md`, etc., prefixed with `Unported upstream PRs — page X of Y`.
- The union of `body.md` and every `comment-NNN.md` contains 100% of candidate entries.

---

## 4. Helper and Tooling Architecture

### `scripts/upstream-intake-ledger.mjs`
A standalone ES module and CLI helper providing:
- Candidate normalization (`normalizeRecord`) and validation (`validateRecord`).
- Deduplication against candidate batches and ported ledgers (`deduplicateCandidates`).
- Deterministic byte-limited pagination (`paginateLines`, `buildReportPages`).
- Markdown report file generation (`writeReportFiles`).
- CLI interface:
  - `node scripts/upstream-intake-ledger.mjs build-report --candidates <file> --outdir <dir> [--ported <file>] [--page-bytes <num>]`
  - `node scripts/upstream-intake-ledger.mjs validate --candidates <file>`
  - `node scripts/upstream-intake-ledger.mjs dedup --candidates <file> [--ported <file>] --out <file>`

### `scripts/upstream-scan-report.sh`
Preserves 100% backward compatibility for existing callers:
```bash
./scripts/upstream-scan-report.sh <upstream-prs.json> <ported.json> <outdir>
```
Adds intake mode delegating to `upstream-intake-ledger.mjs`:
```bash
./scripts/upstream-scan-report.sh --intake <candidates.json> <outdir> [ported.json] [page-bytes]
```

### `tests/unit/upstream-intake-ledger.test.js`
Unit test suite covering:
- Record normalization and schema validation.
- Invariant enforcement (titles never infer ports).
- Multi-source canonical ID isolation.
- Deduplication precedence and source qualification.
- Byte-limit pagination and complete candidate retention.
- CLI execution and shell script delegation.

---

## 5. Verification and Delivery

1. **Static Analysis**: Verified via `node --check scripts/upstream-intake-ledger.mjs`, `node --check tests/unit/upstream-intake-ledger.test.js`, and `bash -n scripts/upstream-scan-report.sh`.
2. **Backward Compatibility**: `scripts/upstream-scan-report.sh` retains identical behavior for classic 3-argument callers.
3. **Delivery Evidence**: Patch, hashes, and verification receipt are delivered to `/Users/heitor/.config/ai-tooling/evidence/durindoor-new-1148-source-20261107`.
4. **Qualification Gate**: Source-stage delivery only. Full runtime execution, test suite runs, and PR publication remain pending independent parent review.
