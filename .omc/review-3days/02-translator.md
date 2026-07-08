# 02 - Translator pipeline review

**Range:** `cfb25e641..origin/dev`
**Scope:** `open-sse/translator/**`, `tests/translator/**`
**Reviewer posture:** skeptic; verified findings only. Earlier draft incorrectly claimed `volcengine-ark` provider was unregistered; corrected below.

## Evidence sources

- `read open-sse/translator/concerns/paramSupport.js` (lines 1-95)
- `read open-sse/translator/concerns/message.js` (lines 1-10)
- `read open-sse/providers/capabilities.js` (PATTERN table and PER_MODEL caps)
- `ls open-sse/providers/registry/volcengine-ark.js` (file exists)
- `grep volcengine-ark open-sse/providers/registry/index.js` (line 100: `import p98 from "./volcengine-ark.js"`)
- `git diff cfb25e641..origin/dev -- open-sse/translator tests/translator --stat`
- `.omc/review-3days/baseline-stats.txt`

## Verified findings

### P1 - `clampToModelMaxOutput` resolves to 128k for `volcengine-ark glm-5`; commit message claims 32k

`open-sse/translator/concerns/paramSupport.js:25`:

```js
{ provider: "volcengine-ark", match: /glm-5/i, clampToModelMaxOutput: true },
```

`open-sse/providers/registry/volcengine-ark.js` exists and is registered in `open-sse/providers/registry/index.js:100`. So the rule is live code, not dead code.

Capabilities lookup for `getCapabilitiesForModel("volcengine-ark", "glm-5")`:

- `open-sse/providers/capabilities.js:365` - PATTERN row `{ pattern: "*glm-5*", caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 128000 } }`.
- No PER_MODEL row for `volcengine-ark/glm-5` (verified by grep against the file).
- So `modelCeiling` resolves to `128000`.

Upstream cap claim:

- The PR that introduced the rule (`port(upstream): #2460 - fix(volcengine-ark): clamp Kimi max_tokens 32768 endpoint cap (#108)` per commit message `20f5ab3ee`) was for **Kimi**, not GLM. The strip rule here is for GLM-5 specifically.
- There is no in-repo documentation of the actual volcengine-ark GLM-5 endpoint cap. Without docs, we cannot prove 128k matches reality.

Risk:

- If the real upstream cap is 32k (matching Kimi), this rule under-clamps and a 33k+ user request still hits a 400.
- If the real upstream cap is 128k, the rule is correct.

Recommended follow-up:

- Verify against `docs.volcengine.com` (or a live request) what the actual GLM-5 max output is on volcengine-ark.
- If 32k, change the rule to `{ provider: "volcengine-ark", match: /glm-5/i, maxOutputCap: 32768 }` to enforce the hard cap.
- If 128k, leave as-is and add a test that asserts the rule fires.

### P1 - `open-sse/translator/concerns/message.js:3-5` collapse change widens contract

Diff:

```
-  return parts.length === 1 && parts[0].type === OPENAI_BLOCK.TEXT ? parts[0].text : parts;
+  return parts.length > 0 && parts.every((part) => part?.type === OPENAI_BLOCK.TEXT)
+    ? parts.map((part) => part.text || "").join("\n")
+    : parts;
```

Behavior change:

- Before: only a single text part returned a string; arrays stayed as arrays.
- After: any number of text-only parts returns a `\n`-joined string.

Risk:

- For an OpenAI body with two text parts, the new function collapses to a single string.
- The function JSDoc still says "a lone text part becomes a plain string" - the comment is now stale.
- A provider like Claude-as-target that expected content as an array of text blocks will receive a flat string. The tests in `tests/translator/thinking-unified.test.js` pass, but no test specifically exercises Claude-as-target with multi-part text content.

Recommended fix: either revert and re-open a separate PR with a test that exercises the new case, or update the JSDoc + add a test for Claude-as-target with multi-part text content.

### P1 - `claude` provider added to known-fails baseline

`tests/__baseline__/known-fails.txt:9` lists `GOLDEN buildHeaders (default executor providers) claude -> headers (apiKey / oauth)` as a known failure. This is a regression vs the pre-window state. The provider registry changed claude headers and the golden test was not updated.

Recommended PR:

- Diff the snapshot before/after for `claude` headers.
- Confirm the new behavior is intentional.
- Either accept the new snapshot (remove from baseline) or fix the upstream change.

### P2 - `clampNumber` only fires when value `> ceiling`

`open-sse/translator/concerns/paramSupport.js:35-39`:

```js
function clampNumber(body, key, ceiling) {
  if (typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] > ceiling) {
    body[key] = ceiling;
  }
}
```

- Silently leaves `body[key]` untouched when value is finite but `<= ceiling`. Caller cannot tell from output whether the clamp ran.
- Not a bug, but a future audit (`did we apply policy?`) cannot rely on body state to tell.

### P2 - Inline `capabilities` import

`open-sse/translator/concerns/paramSupport.js:1` imports `getCapabilitiesForModel` directly from `../../providers/capabilities.js`. Several other concerns import the same symbol. A barrel under `open-sse/providers/capabilities/index.js` would deduplicate the path string. Not a defect; hygiene only.

## Translator bug summary table

| Severity | File:line | Issue | Verified? |
|---|---|---|---|
| P1 | `open-sse/translator/concerns/paramSupport.js:25` | `clampToModelMaxOutput` for volcengine-ark GLM-5 resolves to 128k via the generic pattern; commit message / upstream docs claim 32k for Kimi and there is no in-repo verification for GLM-5 | yes |
| P1 | `open-sse/translator/concerns/message.js:3-5` | Multi-text collapse widens contract; JSDoc stale; no test for Claude-as-target with multi-part text | yes |
| P1 | `tests/__baseline__/known-fails.txt:9` | claude provider golden test absorbed into baseline | yes |
| P2 | `open-sse/translator/concerns/paramSupport.js:35-39` | `clampNumber` does not signal whether it ran | yes |
| P2 | `open-sse/translator/concerns/paramSupport.js:1` | Inline import | yes (hygiene only) |

## Source artifacts

- `.omc/review-3days/translator.patch` (raw diff)
- `.omc/review-3days/baseline-stats.txt` (regression counts)
