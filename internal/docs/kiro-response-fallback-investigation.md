# Kiro response fallback investigation

At integration head `7203f3e8e4ba0bd782025c4d391daa9098e2786e`, the reported four assertion failures did not reproduce. On Node 24.22.2, the following command passed all 12 tests:

```sh
cd tests
node node_modules/vitest/vitest.mjs run unit/port9r-kiro-responses-0957919.test.js --maxWorkers=2
```

During the investigation, removing the test's environment isolation caused two tests to fail when `DURINDOOR_KIRO_CREATE_RESPONSE=off` was supplied. The isolation has been restored so ambient settings do not affect the default fallback tests. This does not establish the cause of the reported integration failures. The original failure output and environment are needed to investigate those failures further.
