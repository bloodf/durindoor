# Image cache test investigation

The integration full-check log reportedly named the image request test in
`tests/unit/portor-next-image-disk-cache-20828.test.js` as failing at
`eda56776519b49a1ea87a8fc1bb31766c27afb50`. Its JSON report was not retained,
and the named log was not available in this checkout. The exact assertion or
runtime error is therefore unknown.

On checkout `baaba555be8efc158df2a65fe53900024a74d2e4`, a descendant of that
integration head, the test file and `next.config.mjs` had no changes relative
to the integration head. Node was `v24.22.2`. After installing the root, CLI,
and test dependencies with `pnpm -C <directory> install --frozen-lockfile`,
the following command ran from `tests/` with a private temporary `HOME` and
`TMPDIR`, an otherwise empty environment except `PATH`, and a five-minute
outer ceiling:

```sh
node node_modules/vitest/vitest.mjs run unit/portor-next-image-disk-cache-20828.test.js --maxWorkers=2
```

Vitest 4.1.12 exited 0: one file and both tests passed. The test run took
798 ms, including 297 ms in tests. No Vitest timeout was changed. An
independent peer also reported both focused tests passing on the integration
head. These focused runs do not reproduce the full-check conditions or explain
the reported failure. No root cause has been established.
