# Kiro response fallback investigation

At integration head `7203f3e8e4ba0bd782025c4d391daa9098e2786e`, the reported four assertion failures did not reproduce. On Node 24.22.2, the following command passed all 12 tests:

```sh
cd tests
node node_modules/vitest/vitest.mjs run unit/port9r-kiro-responses-0957919.test.js --maxWorkers=2
```

With `DURINDOOR_KIRO_CREATE_RESPONSE=off` supplied to the same command, two tests failed because fallback was disabled. This demonstrates an environment dependency in the test file, but does not establish the cause of the reported integration failures. The original failure output and environment are needed to investigate those failures further.
