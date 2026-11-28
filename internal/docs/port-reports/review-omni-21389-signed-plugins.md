# Review: OmniRoute #21389 — signed marketplace plugin install (opt-in)

## Upstream identity (read via `gh api`, read-only)

- PR: https://github.com/cheaper-inference/OmniRoute/pull/21389
- Title: `feat(plugins): verify signed marketplace packages before install (opt-in)`
- State at review: **open**, not draft, `updated_at` 2026-11-27T02:17:37Z
- Base: `release/v3.8.55` @ `9671192011beb2d7f83979f40be488c5da8772b9`
- Head: `feat/plugins-verified-marketplace` @ `eec6967beacbaf9b5d6bb540d2306673a3b73b7c`
- Size: 14 changed files, +1714 / −39
- Upstream code paths: `src/app/api/plugins/marketplace/install/route.ts`, `src/lib/plugins/marketplace.ts` (exists at base), `src/lib/plugins/marketplaceArchive.ts` (new), `src/lib/plugins/marketplaceIntegrity.ts` (new), flag `PLUGIN_MARKETPLACE_INTEGRITY_ENABLED` (default `false`).

Behavior claimed upstream: with the flag on, a Marketplace install fetches a signed index, verifies an Ed25519 detached signature over the exact index bytes against a trusted key, checks a validity window, checks the archive SHA-256, and safely extracts the tarball. With the flag off, the original install contract is unchanged.

## DurinDoor comparison

Compared against `origin/main` @ `29490b783e` and the frozen integration head `d27f288cb5` (`orq/tp3r51/integration` merge). `d27f288cb5` is **not** an ancestor of `origin/main`. Both were read as Git objects (`git ls-tree`, `git show`, `git grep`), not from the working tree.

- No plugin marketplace installer exists on either ref. `git ls-tree -r --name-only <ref> | grep -i plugin` returns only:
  - `open-sse/config/providerPluginManifest*.js` and `src/app/api/v1/provider-plugin-manifest/route.js`
  - `src/app/api/mcp/[plugin]/{sse,message}/route.js` (MCP transport routes, unrelated)
- There is no `src/lib/plugins/` and no `src/app/api/plugins/` on either ref.
- The closest remote-fetch surface, the provider plugin manifest, is read-only metadata:
  - `open-sse/config/providerPluginManifestClient.js:24` `fetchProviderPluginManifest` fetches a JSON manifest and returns data.
  - `src/app/api/v1/provider-plugin-manifest/route.js:17-18` `GET` returns `generateProviderPluginManifest()` as JSON.
  - Nothing downloads, extracts, or executes a package.
- `src/shared/constants/coworkPlugins.js` is a static list. `McpMarketplaceModal.js` fetches a registry for display; it does not download or extract packages.
- No DurinDoor code path verifies signatures, checksums, or tar archives for plugin packages. `grep` for `ed25519|sigstore|cosign|minisign|verifySignature` in `src/lib/plugins`, `src/app/api/plugins`, and `src/shared/constants` finds nothing.

## Prior records

- `origin/main` `internal/docs/port-reports/1073-20895-train-e2.md:49` already records that DurinDoor has "no `src/lib/plugins` module" and no plugin hook surface.
- `origin/main` `internal/docs/port-reports/open-prs-nov25-26.md` (row 1005, #19725) records the same absence for the upstream plugin marketplace loader.
- `origin/main` `internal/docs/port-reports/2026-11-27-full-parity-refresh.md:1693` lists #21389 as `Unrecorded at this head; review required`. This report resolves that row.

## Overlap check

- No active sync-lane owner covers plugin installation. The owned PRs (#21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433, 9router #5884/#5904) touch provider catalog quotas, abort propagation, unknown-model 404s, and related provider and sync work.
- No existing review or claim file in the repo covers #21389 other than the full-parity-refresh row above.
- I did not query the DurinDoor issue tracker or PR list for claims. This was a read-only, repo-scoped check.

## Verdict

**Intentional / inapplicable: the surface this PR hardens does not exist in DurinDoor.**

The change adds Ed25519 signature, SHA-256, and safe-extraction checks to an install path that DurinDoor does not ship. There is no local behavior to compare and no defect to reproduce. Porting the signed-install layer alone would add dead code with nothing to call it.

Severity: none for the current product.

Re-open this review only if DurinDoor adds a plugin package installer or marketplace download. At that point, the upstream integrity layer (`marketplaceIntegrity.ts`, `marketplaceArchive.ts`) becomes a candidate port.

## Uncertainty

- Verdict is against upstream head `eec6967`. The PR is still open and the head may move.
- I did not read the full upstream diffs for `marketplace.ts`, `marketplaceArchive.ts`, or the tests. The verdict depends only on the absence of the installer surface, which I verified on both refs.
- The `McpMarketplaceModal` registry fetch was checked only for download and extraction. I did not assess whether MCP registry entries can run commands, because that is outside this candidate.
- No tests were run and no product was executed. Source inspection only, per the review scope. Dependencies were not installed.
