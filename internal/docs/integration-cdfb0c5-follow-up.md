# Follow-up to the cdfb0c5 test investigation

On 2026-11-23, a follow-up ran at `baaba555be8efc158df2a65fe53900024a74d2e4`, a descendant of the original integration head. The earlier investigation is recorded in commit `71274879f4b3810a77ab3be81e1fcff0426c4169`. Its original detailed failure report had been overwritten, so the original failure messages remain unknown.

The follow-up used Node 24.22.2, frozen root, CLI, and test dependencies, a private `HOME`, and a disposable `DATA_DIR`. From `tests/`, it ran:

```sh
node node_modules/vitest/vitest.mjs run unit/chat-billing-epoch.test.js unit/media-async-budget.test.js unit/megabrain-provider.test.js unit/v5-terminal-interleaving.test.js --maxWorkers=2
```

The command exited 0 with the configured timeouts:

```text
Test Files  4 passed (4)
     Tests  19 passed (19)
  Duration  17.99s (transform 12.53s, setup 0ms, import 459ms, tests 33.22s, environment 1ms)
```

Wall time was 19.00 seconds. Vitest reported 8,457 ms for the reported chat billing case, 3,130 ms for the video job estimate case, 9,503 ms for the MegaBrain case, and 3,527 ms for the `gpt-5.4` terminal interleaving case. The following `gpt-5.4-mini` case took 492 ms. These case durations include their hooks. Vitest's transform and test totals aggregate time across workers and are not wall-clock components that can be added together.

The chat and terminal tests reset modules and import application code in their per-test setup. MegaBrain imports routes inside its test body. The earlier investigation observed hook and test timeouts during load of 71.40 on a machine reporting 20 CPUs. Load was 25.58 at the start of this run. Cold module loading and shared-machine pressure are plausible contributors to the later timeouts, but these observations do not isolate their costs or establish the cause of the original failures. No product or test defect was established, and no timeout, assertion, or baseline was changed.
