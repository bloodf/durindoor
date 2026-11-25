# Session and project usage attribution

Chat requests authenticated by a stored application API key may include
`X-DurinDoor-Session-Id` and `X-DurinDoor-Project-Id`. Each value must be 1–128
ASCII characters: letters, digits, `.`, `_`, `:`, `@`, `/`, and `-`; the first
character must be a letter or digit. Invalid, repeated, and oversized values are
ignored. These labels are supplied by the caller and are only reporting labels:
they do not identify a user or grant access to anything. Do not put secrets or
personal information in them. Requests without a stored key are not attributed.

Each key may have at most 1,000 distinct session labels and 1,000 distinct project
labels in retained usage history. At the limit, existing labels remain usable;
new labels are omitted while the usage event is still recorded. Pruning or
resetting usage history releases capacity. Labels are retained and deleted with
their usage rows.

`GET /v1/me/sessions` requires a valid stored application API key. It returns
only rows charged to that key, grouped by session and project, with request,
token, cost, unknown-cost count, and last-use totals. Project-only rows appear
with a null session ID. The optional `limit` is an
integer from 1 to 100 (default 50); results are ordered by most recent use. The
report covers retained chat usage written after this feature is enabled; it does
not infer labels for older rows or other endpoints. Other key IDs and caller
labels never select the scope. Key rotation preserves the stable key association.

This feature does not capture or expose message contents. Existing request-detail
observability has separate settings and is not enabled by these headers.

Migration 031 adds nullable attribution columns and key-scoped indexes without
rewriting existing usage or API key secrets. Its version is recorded only after
the migration succeeds; a failed upgrade is retried on the next open.

Session rows also include a `tokens` split: `input` includes `cacheRead` and
`cacheCreation`, `uncachedInput` is the remainder, and `output` includes
`reasoning`. `total` is input plus output. For older rows whose prompt count is
smaller than the sum of cache counters, the cache counters are added to input.
