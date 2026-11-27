# TrustedRouter — #2642

Inspected the complete current diff of
[OmniRoute #21364](https://github.com/cheaper-inference/OmniRoute/pull/21364),
head `91b54071eeec9c5c6d306c90c7738a2999f6b11d`, on 2026-11-26.
The diff is not truncated and includes the implementation preceding the head's
changelog commit. Also read `omni-review-verified.md`.
Local base: `47e80b55c698f4b8641dc5fb3c581bf80faedab9`.

Ported native API-key registration, authenticated key checking, visible-chat
discovery, limits/capabilities, twelve seed chat models, and nine embeddings with
dimensions using the local registry and embedding adapter. The Responses endpoint
is retained as registry metadata, matching other local compatible providers.
No new Responses executor or translator is introduced.

Successful chat discovery merges the curated embedding rows so authoritative
model sync retains their kinds and dimensions. An empty or malformed chat
catalog stays empty, allowing the existing sync failure path to retain prior data.

Vendor model IDs stay intact under the outer TrustedRouter provider prefix.
Local identity parsing already splits only the outer provider component; it does
not use the upstream global bare-model registration mechanism. Upstream
`requiresProviderPrefix` annotations are retained on vendor seeds.

Validation disables the generic billed-chat fallback. Discovery uses the fixed
HTTPS catalog URL with manual redirects; chat ignores connection/runtime URL
overrides and uses the fixed HTTPS completion endpoint with redirect rejection.
Embeddings derive their fixed HTTPS URL from the registry and reject redirects.
The existing guarded validation fetch rejects redirects. No provider was contacted.

Offline tests cover status classification, discovery filtering and metadata,
vendor identity, real executor and embedding-handler dispatch, credentials,
redirect policy, and hostile HTTP/file/HTTPS/userinfo URL overrides. Generated
registry and agent indexes were regenerated with their repository scripts.

The provider discovery eligibility list in the dashboard Storybook fixture also
includes TrustedRouter. Only its dependent pending scenario source hashes were
refreshed; no visual approval or review status was changed.

Validation:

- Root `pnpm run lint` passed. Final changed-source ESLint and the complete
  anti-slop gate also passed after the discovery merge adjustment.
- Focused TrustedRouter and neighboring provider files passed (17 assertions);
  the final TrustedRouter plus V5 provider fixture rerun passed (22 assertions).
- `pnpm -C tests run test:ci` completed all twelve batches. Its report contains
  two failures: the provider fixture eligibility mismatch (fixed and rerun above)
  and the pre-existing `1300-v5-storybook-inventory.test.js` stale endpoint
  dashboard hashes. The remaining 44 inventory diagnostics refer exclusively to
  unchanged endpoint dashboard sources/scenarios. No baseline entries were added.
- Commit subject passed commitlint; `git diff --check` passed.

Full CI is therefore not green. No PR, merge, provider call or deployment was
performed as part of this port.
