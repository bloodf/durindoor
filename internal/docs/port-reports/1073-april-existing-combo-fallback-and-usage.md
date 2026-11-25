# #1073 April existing combo fallback and usage comparison

Inspected the exact first-parent merged patches in the pinned OmniRoute source repository at `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`, then compared them with the current DurinDoor router and its verifier fixtures. PR titles and matching filenames were not used as behavior evidence.

## Dispositions

| Source pin | Disposition | Runtime comparison |
| --- | --- | --- |
| [OmniRoute #1398 merge `3bc97b3e37129f9346247703ee055212a28c8fe3`](https://github.com/cheaper-inference/OmniRoute/blob/3bc97b3e37129f9346247703ee055212a28c8fe3/open-sse/services/combo.ts), head `cb23440c7e8b46bf9e0123eac6215cbc8f4dfe3f` | **Already covered, with broader current behavior.** The source adds an exact 503 + JSON content type + `unavailable` message exception to both priority and round-robin fallback gates. DurinDoor's [shared classifier](../../../open-sse/services/accountFallback.js) treats eligible transient 503s as fallback-able without this content-type/message gate, and [combo dispatch](../../../open-sse/services/combo.js) follows `shouldFallback`. Existing local assertions cover transient 503 as non-request-scoped in [the 5cdcddf5 fixture](../../../tests/unit/port-5cdcddf5-combo-request-scoped-4xx.test.js); they do not pin the source's narrower JSON signal because local policy already advances on ordinary transient 503. No remaining scoped fix identified. |
| [OmniRoute #1685 merge `58fb988c52e76214ed9e423da448a4a6e637550a`](https://github.com/cheaper-inference/OmniRoute/blob/58fb988c52e76214ed9e423da448a4a6e637550a/open-sse/services/combo.ts), head `e46575b5bf6f37d7f662cece8c1a77f9d4f2ce2a` | **Already covered as a semantic no-op.** Its exact patch replaces literal Chinese characters in fallback regexes with equivalent JavaScript `\uXXXX` escapes. DurinDoor has no corresponding copied pattern table in `combo.js`; current message classification lives in `accountFallback.js`. The encoding-only source edit does not establish a runtime policy delta to port. |
| [OmniRoute #1710 merge `aa535748efd20e2fb17aaee4e03562b71f040b00`](https://github.com/cheaper-inference/OmniRoute/blob/aa535748efd20e2fb17aaee4e03562b71f040b00/open-sse/services/combo.ts), head `f83901a90e2c2fdcf941f405c3b96c2a2e20c0e3` | **No runtime delta in this exact patch; not independently portable.** Its only runtime-file addition is an unused `qualityFailureReason` local. The quality validation, failure recording, `lastError`/502 state, and break were already present in the first parent. DurinDoor's `handleComboChat` has no equivalent `validateResponseQuality` branch; its 200 path detects tunneled errors, empty streams, and empty bodies ([combo success handling](../../../open-sse/services/combo.js)). That broader behavior difference predates this pinned patch and is not a justified port from #1710. No local fixture asserts quality validation of non-empty malformed 200 responses. A separate audit of that earlier behavior could establish whether any scoped fix is appropriate, while preserving provider usage writes and charge semantics. |
| [OmniRoute #1713 merge `42952ee42f5da8f64a82e260e49231c91abafff3`](https://github.com/cheaper-inference/OmniRoute/blob/42952ee42f5da8f64a82e260e49231c91abafff3/open-sse/services/combo.ts), head `101f406a90986e3921fd2f3d4b420e4cf10ece7e` | **Incompatible as a direct change.** The source removes combo-level error gates so every non-OK target falls through, including generic 400s and provider-breaker responses. DurinDoor intentionally distinguishes request-scoped 4xx from account/transient failures: [unmatched 4xx](../../../open-sse/services/accountFallback.js) become request-scoped, [the combo loop](../../../open-sse/services/combo.js) advances while retaining the first rejection, and [the verifier](../../../tests/unit/port-5cdcddf5-combo-request-scoped-4xx.test.js) asserts both recovery and return of that first response when all targets reject. A blanket continue would also cross explicit terminal/local boundaries. The current fixtures already demonstrate generic `Bad request` advancing through request-scoped handling in [combo-credit-fallback](../../../tests/unit/combo-credit-fallback.test.js); no broad policy rewrite is needed. |

## Usage and accounting boundary

OmniRoute's patches record per-combo attempts with `recordComboRequest`, `fallbackCount`, strategy, and target. That accounting layer does not exist in the DurinDoor combo loop. DurinDoor records usage at the provider-handler layer: non-streaming and streaming handlers pass `comboId`/`comboName` into `saveUsageStats` ([non-streaming](../../../open-sse/handlers/chatCore/nonStreamingHandler.js), [streaming](../../../open-sse/handlers/chatCore/streamingHandler.js)). The local integration verifier confirms one attributed usage row per completed provider request, with direct and historical requests remaining unattributed ([combo usage fixture](../../../tests/unit/combo-connection-usage-attribution.test.js)); its served-model breakdown fixture covers totals and error rows ([model usage fixture](../../../tests/unit/combo-model-usage-attribution.test.js)).

Accordingly, none of the source `recordComboRequest` or fallback-count bookkeeping is proposed for port. The existing charge/usage lifecycle stays in the provider handlers; the router explicitly rethrows `USAGE_ACCOUNTING_FAILED` rather than dispatching another model ([combo catch](../../../open-sse/services/combo.js)).

## Remaining-fix assessment

None of these four exact patches establishes a ready scoped remaining fix: #1398's target fallback is covered by broader transient policy; #1685 is encoding-only; #1710's runtime behavior predates its patch; and #1713's blanket fallback conflicts with request-scoped and terminal boundaries already covered locally. The separate quality-validation gap mentioned above is outside the behavior change in #1710 and needs its own source evidence and contract review.

## Local verification

Attempted the focused existing verifier files from `tests/`:

```text
node node_modules/vitest/vitest.mjs run unit/port-5cdcddf5-combo-request-scoped-4xx.test.js unit/combo-credit-fallback.test.js unit/combo-connection-usage-attribution.test.js unit/combo-model-usage-attribution.test.js --maxWorkers=2
```

The run could not start because this checkout has no `tests/node_modules/vitest/vitest.mjs` (`MODULE_NOT_FOUND`). No dependencies were installed. The dispositions above cite the checked-in verifier assertions as local evidence; they are not represented as a passing test run.

All four exact source head and merge pins are recorded above. Only this internal report is changed.
