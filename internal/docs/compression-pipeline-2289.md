# Compression pipeline (#2289)

Decision 19 uses the pure `resolveCompressionConfig(settings)` runtime view. Missing
keys inherit `DEFAULT_SETTINGS`: RTK/PXPIPE on, headroom/caveman prompt/stack off.
With the request token-saver switch on, RTK and headroom read flat enabled OR
(`compressionEnabled` AND the matching map entry enabled). A false map value never
cancels a historical true flat value. Caveman prompt and PXPIPE read flat settings.
Options remain flat; existing API, CLI and dashboard payloads remain compatible.

Writes mirror aliases through `mergeSettingsPatch`, shared by normal and password
epoch writes. An explicit map boolean wins a conflict and mirrors to flat; flat
writes mirror only into existing entries, preserving options and siblings. The
aliases are `rtk`/`rtkEnabled`, `headroom`/`headroomEnabled`,
`caveman-prompt`/`cavemanEnabled` (plus `level`/`cavemanLevel`), and
`pxpipe`/`pxpipeEnabled`. Map `caveman` remains the gated text rewriter. Map removals
and empty patches keep their existing semantics. Settings-route reauth evaluates
the mirrored patch, so nested headroom enabling requires the same proof as flat.

Order remains source headroom, RTK at its dedicated position (source for Cursor,
translated for other providers), remaining stack engines, tool-turn repair,
additive prompt injection, PXPIPE, final repair. The stack skips already attempted
RTK/headroom stages even after a skip or rollback. Source and target formats are
explicit. Cursor never retries RTK on the translated XML tool-result text.

All saver mutations use `runCompressionStage`: isolated input, fidelity check,
commit, or fail-open with no mutation. Structural checks protect tool schemas,
result IDs, thinking, signatures, media, errors, instructions and fenced code.
RTK retains its existing `rtkGate` policy: stack-selected RTK is fidelity-gated;
plain legacy RTK remains ungated but restores its input on errors. Prompt stages use an
additive check preserving existing fields, block order and content; the prompt
injector is distinct from the text rewriter in logs and typed event stage IDs.
PXPIPE must preserve protected content just like other compression stages.

The typed `CompressionEvent` extends the existing normalized event with ordered
stage IDs. Existing RTK/headroom/PXPIPE fields, stack-only token estimates in
`compression`, byte totals, response-header format and DB projection stay intact.
Stack savings measure actual input/final output, excluding earlier dedicated
stages. No SQL migration, version marker, materialized engine map or stored-row
rewrite is introduced. Historical migrations and their aggregation schema remain
frozen.

`compact.js` was already removed on this base. Checkout-scoped tracked-file and
import searches confirm no runtime importer. Regression coverage exercises saved
combo lookup and fallback through `combo.js` and the real compression seam;
existing nested/fusion routing and saver-accounting tests remain in place.

Focused evidence (private HOME/DATA_DIR/caches, credential-free environment):

```sh
cd tests
node node_modules/vitest/vitest.mjs run unit/arch-2289-compression-pipeline.test.js unit/omni-compression-engine-clear.test.js unit/compression-settings-compat-1073.test.js --maxWorkers=2
```

Scoped lint and anti-slop checks cover changed source; additional focused cases
cover headroom formats, frozen migrations, Cursor, fidelity, telemetry and real
combo routing. No live provider, real data, full suite or deployment is needed
for this work order.

Validation: the required three-file command passes all 45 assertions. The retained
RTK stack suite also passes all ten cases, including legacy plain-RTK policy.
Its off-case fixture explicitly supplies `rtkEnabled: false`; omission now
correctly inherits the on default.
Expanded focused coverage passes for real nested/fusion combo routing, saver
accounting, headroom formats, frozen migrations, stack headers, fidelity and
adaptive budgets. Scoped ESLint and anti-slop pass with no diagnostics. A transient
`/tmp` inode exhaustion interrupted one collection; the focused rerun passed
after space recovered. No full local CI was started under the machine pressure
notice.
