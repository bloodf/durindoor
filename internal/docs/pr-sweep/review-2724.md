Verdict: CHANGES
PR: #2724; reviewed head a5110a8dcfaa4174760b52948f8a855240233720; detached side checkout head unchanged (no side branch).
origin/main: c0ab5d52df1a4c9f8cf2bfa26c16cbe0ac845492; merge-base: 795f37e414a149fae28531bc486e1918eda96320.
Conflicts: none; no merge or conflict resolution performed.
Finding P2: tests/__baseline__/vitest-projects.mjs:101 silently ignores an extensionless local import when the resolved file is `.jsx` (also `.ts`/`.tsx`). A test importing such a helper that starts a listener is classified as unit. Unresolved imports should fail closed, and supported resolution extensions must be traversed.
Reproduce from the reviewed checkout (exit 0; prints `false`, expected `true`):
```sh
node --input-type=module -e 'import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs"; import {tmpdir} from "node:os"; import {join} from "node:path"; import {createFileClassifier} from "./tests/__baseline__/vitest-projects.mjs"; const r=mkdtempSync(join(tmpdir(),"classify-")), t=join(r,"tests"); mkdirSync(t); writeFileSync(join(t,"x.test.js"),`import "./helper";`); writeFileSync(join(t,"helper.jsx"),`server.listen(0);`); console.log(createFileClassifier(t,r)("x.test.js"));'
```
Cache assessment: `CACHE_VERSION` is manual; hashing classifier implementation would automatically invalidate records when classification changes and is safer than relying on a future manual bump. This is a maintenance risk, not a separate present-head finding.
Commands below ran at the detached head, each with fresh private HOME, DATA_DIR, TMPDIR, XDG_CACHE_HOME, `env -i` and `timeout -k 5s 295s`; logs are under `/var/tmp/review2724-*.log`. No related, browser, e2e or full inventory run was requested.
- `node tests/node_modules/vitest/vitest.mjs --version`: exit 0; Vitest 4.1.12.
- `node tests/__baseline__/check-vitest-projects.mjs`: exit 0; unit 888, integration 2497, union 3385; same from repository root, no duplicates or drops.
- `node tests/node_modules/vitest/vitest.mjs run tests/unit/vitest-projects-classifier.test.js --config tests/vitest.config.js --maxWorkers=2`: exit 0; 1 file, 14 passed, 0 failed.
- `node tests/node_modules/vitest/vitest.mjs run tests/unit/review-x-dead-baseline.test.js --config tests/vitest.config.js --maxWorkers=2`: exit 0; 1 file, 1 passed, 0 failed.
- `node node_modules/eslint/bin/eslint.js src`: exit 0; 0 errors, 347 warnings.
- `node scripts/build-anti-slop-plugin.mjs`: exit 0; bundle built.
- `node scripts/check-anti-slop.mjs`: exit 0; 0 diagnostics, 3411 files.
- `node node_modules/next/dist/bin/next build --webpack`: exit 0; production build passed.
- `node cli/scripts/build-cli.js`: exit 0; CLI package built.
- `npx --no-install commitlint --from=795f37e414a149fae28531bc486e1918eda96320 --to=a5110a8dc`: exit 1; commitlint is absent from shared dependencies; npx refused to install it. No range result available.
The wider reduced gate's standalone typecheck, docs/catalog checks and title commitlint were not part of the requested command list and were not run; this is not a complete merge-gate receipt.
