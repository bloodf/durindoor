# nix/ — DurinDoor reproducible Nix packaging evaluation

Issue #1147: `port(upstream): evaluate reproducible Nix packaging`.
Upstream 9router #1405 and #4631 remain open; this is a planning evaluation,
not an adopted packaging change. No Nix install/eval/build was performed.

## Owned files

- `nix/package.nix` — derivation proposal (source only).
- `nix/README.md` — this file.
- `tests/fixtures/nix-package-contract.json` — machine-readable contract.

No other files were touched: `package-lock.json`, root `package.json` scripts,
and the pre-existing `tests/fixtures/*` files are unchanged.

## Purpose

Propose a finite, reproducible Nix derivation for DurinDoor 4.11.0 that
mirrors the Dockerfile runner stage (`Dockerfile`) and the
`scripts/build-app.mjs` materialized file set, plus the `durindoor` CLI
package (`cli/`).

## Inputs

| input | source |
|-------|--------|
| source | `bloodf/durindoor` @ `044632eb8bc4cd51a65340fb6c87100879969e70` (current HEAD) |
| nodejs | `pkgs.nodejs_26` — package.json engines require Node 26.13.0; exact pin UNRESOLVED |
| python3, make, gcc, linux-headers, cmake | Dockerfile builder-stage toolchain (`apk add --no-cache python3 make g++ linux-headers cmake`) |

## Derivation summary (`nix/package.nix`)

1. `src = pkgs.fetchFromGitHub bloodf/durindoor @ rev` — sha256 UNRESOLVED.
2. `buildPhase`: `npm ci --ignore-scripts` then `npm run build`
   (`scripts/build-app.mjs` produces the Next.js standalone root plus
   materialized sidecars).
   - `cli/hooks/postinstall.js` is skipped (`--ignore-scripts`): it installs
     sqlite/tray into `~/.durindoor/runtime`, non-fatal at runtime, intentionally
     out of scope for this evaluation.
   - `doCheck = false` — planning ticket asserts no runtime test.
   - `npm ci` network-sandbox handling UNRESOLVED; a vendored `nodeModules`
     input (`npmDepsHash`, UNRESOLVED) is reserved for it.
3. `installPhase`: assembles `$out/bin/durindoor` and
   `$out/lib/durindoor/{server,cli}`, mirroring the Dockerfile runner-stage
   `COPY --from=builder` set (`public`, `.next/static`, `.next/standalone`,
   `custom-server.js`, `head-response-guard.cjs`,
   `web-login-host-boundary.cjs`, `src/shared/utils/normalizeEnv.js`,
   `typeChecks.js`, `typeChecks.cjs`, `open-sse`, `src/mitm`,
   `node_modules/{node-forge,next,sql.js,playwright,playwright-core,tls-client-node,wreq-js,@wreq-js}`)
   and the build-app.mjs materialized sidecars (`wsHandshake.js`,
   `realtimeConfig.js`, `processExitCodes.js`, `sql.js/dist/sql-wasm.{js,wasm}`).

## Validation (state only — commands not run)

Nix is not installed in this environment; only syntax/AST checking applies.

```
nix-instantiate --parse nix/package.nix
nix eval -f nix/package.nix package --json   # requires nixpkgs on NIX_PATH
```

## Unresolved (owner decision required; no guessed hashes, no network-sandbox bypass)

- `src` sha256 for `fetchFromGitHub`
- `npmDepsHash` / `npm ci` source under network sandbox
- exact Node 26.13.0 pin vs `pkgs.nodejs_26` nixpkgs drift
- Node 24 migration (#1663) is pending — baseintegration first; not silently required here

No commit, push, or PR until independent parent review.
