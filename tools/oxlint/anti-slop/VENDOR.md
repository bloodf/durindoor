# Vendored anti-slop

This directory is a vendored copy of [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop) `src/`.

anti-slop is **not** an npm dependency. Upstream guidance: copy the rules into the
repository, then maintain them locally.

| Field | Value |
| --- | --- |
| Upstream | https://github.com/dmmulroy/anti-slop |
| Vendored SHA | `6d538555cb151d4121ed51a27db81890eacf8ae9` |
| License | MIT (see `LICENSE`) |

Effect rules under `effect/` are vendored for completeness but are **not**
registered in `.oxlintrc.json` (DurinDoor does not depend on Effect).

To refresh from upstream: replace this directory with a fresh copy of `src/`,
update the SHA in this file, regenerate `tools/oxlint/anti-slop-baseline.tsv`
via `node scripts/check-anti-slop.mjs --update-baseline`, and re-run
`npm run lint:anti-slop`.
