# #1073: June OmniRoute merged-source scope

Reviewed 2026-11-20. This note reconciles the June 2026 merged pull request
search scope against the source evidence available in this checkout. It is a
read-only documentation audit; it does not select work for an owner.

## Source window and collection boundary

The verified upstream query was
`repo:cheaper-inference/OmniRoute is:pr is:merged merged:2026-06-01..2026-06-30`.
It returned **1,677** records. To keep collection bounded, the search was
split into three date windows. GitHub returned 325 records for June 1–10 and
590 for June 11–20. The search endpoint rate-limited before the June 21–30
window could be collected. Given the verified monthly total, 762 records
remain in that final slice by subtraction; this is not an independently
queried slice count. No complete row-level metadata or final diff set for the
1,677 records was obtained in this audit.

Consequently, this report does not classify the 762 uncollected records, nor
does it claim exhaustive review of the other 915. Titles, date-window totals,
and path-name similarity are not evidence that a change applies locally. A
fork PR counts as source evidence only when its actual port can be mapped to
the upstream record and its behavior checked in the current tree.

## Defensible existing evidence

The existing historical reconciliation provides concrete local security and
protocol evidence, but it does not establish that these source PRs fall in
the June window. They are recorded here as validated local examples, not as
June dispositions:

- OmniRoute #6542 is mapped to local port commit `3d00c34691`; the existing
  reconciliation points to `open-sse/utils/outboundUrlGuard.js` as current
  outbound URL guard evidence. Its upstream source SHA and exact date-window
  membership are not present in that reconciliation, so no June attribution
  is made here.
- OmniRoute #6620 maps to local DurinDoor #184, commit
  `29ba2288e08d7f8879db059b5fdf8ca791771811`, whose port body records source
  SHA `0eda8ab09c`. The current `open-sse/utils/proxyFetch.js` keeps
  `proxyTunnel: true`; the original port commit is not in current ancestry,
  and the behavior is present through `cb40de41d`. This is a verified
  protocol example, not a verified June source record.
- OmniRoute #15566 maps to source head
  `5ad99cb631406aaad1621a53d9f091809089ac26`; local catalog behavior keeps
  literal tiered model IDs. OmniRoute #15543 maps to source head
  `efd217ad472e85c68bfc4c86f9bf73a118684529`; its Command Code Messages
  endpoint is a different provider contract from this fork's
  `/alpha/generate` route. Both are documented in
  `1073-existing-provider-request-residuals.md` and were merged in October,
  outside this source window. Neither is evidence of a June port.

These examples demonstrate the required evidence standard: source identity
and SHA, changed behavior or endpoint, and local source behavior. They do not
justify extrapolating disposition across the June inventory. The available
June-specific classifications are therefore **none confirmed** in this
review; this means unreviewed, not absent or inapplicable.

## Exclusions and preserved uncertainty

New provider identities, features, endpoints, integrations, and sign-in or
authentication-flow work remain excluded from this scope. This excludes
candidate categories only; it does not classify all records in those
categories by title. Existing-provider security or protocol fixes may still
be applicable, but require the final diff and a mapped local behavior check.

Dependency-security scope remains unresolved where the source record, local
dependency version, or patch evidence is missing. To close a specific
candidate, record its upstream PR number and merged source SHA; the changed
dependency and advisory/CVE; the local direct or transitive package name and
version from the manifest and lockfile; and the exact fixed version or patch
already present (or absent). Then compare the source diff and confirm the
local dependency graph actually reaches the affected code. Without that
evidence, neither “already fixed” nor “applicable gap” is defensible.

## Explicitly unverified

- Row-level source metadata, changed paths, and final diffs for the 762
  records in the uncollected June 21–30 slice.
- Whether any of the June records map to prior fork PRs or commits; no
  mapping is inferred from similar titles or paths.
- June-specific applicability for provider, protocol, or security changes
  among the 915 records in the first two windows; only their aggregate
  counts were collected here.
- Dependency-security records without local version and patch evidence.
- Any upstream changes after the verified June search, and any behavior not
  established by static inspection of the cited local source.

No live provider or network behavior, credential, browser, e2e path, full
suite, Docker, exploit, or reproduction was used. Bulk source metadata was
not retained in the repository. The #1073 archive's overall 15,357-record
inventory is a separate snapshot collected 2026-10-08; it is not substituted
for this June merged-date search.
