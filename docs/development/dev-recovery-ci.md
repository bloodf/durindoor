# Development recovery and CI contract

DurinDoor's recovery checks use Node `20.20.2` and npm `10.8.2`. Both the root
application and `tests/` dependency graphs have committed lockfiles and CI uses
`npm ci`; dependency changes must update the corresponding lockfile.

## Database migration order

Schema versions are an append-only compatibility contract:

1. Versions 1–3 contain the original SQLite and MCP schema.
2. Version 4 adds `apiKeys.dailyLimitTokens`. This version was published and
   must never be reassigned.
3. Version 5 adds `apiKeys.expiresAt` without deleting or rotating stored keys.
4. Version 6 adds `apiKeys.policy`, creates `apiKeyUsageTotals`, and backfills
   lifetime totals from retained usage history.

The upgrade tests cover fresh databases and upgrades from versions 3, 4, and 5.
Pre-upgrade SQLite backups are checkpointed and copied before the first schema
mutation. Legacy JSON imports and backups that predate lifetime totals rebuild
the totals after their keys and usage history are available.

API-key policy data is validated before database import and malformed stored
policies fail closed. Each API-key-gated request is authorized against the
resolved provider/model, including combo and fallback attempts. Non-chat usage
is added to lifetime totals only for the successful target; failed validation,
account retries, and upstream errors do not consume the limit.

Usage APIs never return key prefixes or unsalted key hashes. Registered keys
are identified by their non-secret database ID and display name; deleted keys
receive request-local opaque labels. This is required because the supported
legacy `sk-<8 hex>` shape has too little entropy for a prefix or public digest
to be a safe mask.

## Test gate

Run the Stage 1 gate from `tests/`:

```bash
npm ci
npm run test:ci
```

The runner deletes stale reports before starting, requires a new parseable JSON
report, rejects startup/collection/runtime errors, creates JSON and JUnit
artifacts, and reports three counts separately:

- raw failures in the current run;
- failures still present in `__baseline__/known-fails.txt`;
- stale baseline entries whose tests now pass.

Pull requests may delete stale baseline entries but may not add entries. The
baseline is temporary recovery state; the zero-test stage removes it entirely.

## Build isolation

`npm run build` executes Next.js with disposable `HOME` and `DATA_DIR` values.
This ensures page collection cannot initialize or migrate the operator's real
database, machine ID, certificates, or dashboard secret. Application bootstrap
is dynamically imported only outside build/prerender phases.

Nightly and release workflows run install, lint, index, build, and test gates
before publication. A failed gate prevents publication.
