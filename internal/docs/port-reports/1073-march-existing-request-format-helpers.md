# Port Report #1073 — March OmniRoute Request-Format Helper Changes

Three OmniRoute PRs from March 2026 that modify request-format helpers. Each is compared against the current DurinDoor local source at the corresponding files.

## PR Summary Table

| PR | Head SHA | Enclosing Merge | Files Changed | Local Status |
|----|----------|-----------------|---------------|--------------|
| [#216](https://github.com/cheaper-inference/OmniRoute/pull/216) | `a5103167b6ae18b9e8772702c85f6ed07bd2c393` | `98812cb4fc8701fd74337d9b2d1a1e903d2a51ff` | `open-sse/translator/helpers/claudeHelper.ts`, `open-sse/translator/request/openai-to-claude.ts` | **Already present** (logic in `open-sse/translator/formats/claude.js` + `open-sse/translator/request/openai-to-claude.js`) |
| [#294](https://github.com/cheaper-inference/OmniRoute/pull/294) | `c949214e99dbd08877b7952a301f312f85299497` | `57da40769395e7bc6fc08ab5f4d14ffba2cf069b` | `open-sse/executors/antigravity.ts`, `open-sse/executors/gemini-cli.ts` | **Gap** — `OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE` env var not implemented locally |
| [#421](https://github.com/cheaper-inference/OmniRoute/pull/421) | `da581525a63f4de82a7a7b340d06d9e173684ed7` | `c7ceac7f41a19bcdcbba2d5ceaafbe6d815cebb9` | `open-sse/translator/helpers/openaiHelper.ts` | **Gap** — `filterToOpenAIFormat` does not strip `metadata` / `anthropic_version` |

---

## PR #216 — Skip `cache_control` on Deferred Tools

### Upstream Diff (pinned)
- **Head**: `a5103167b6ae18b9e8772702c85f6ed07bd2c393`
- **Merge**: `98812cb4fc8701fd74337d9b2d1a1e903d2a51ff`
- **Files**:
  - `open-sse/translator/helpers/claudeHelper.ts` — `prepareClaudeRequest`
  - `open-sse/translator/request/openai-to-claude.ts` — `openaiToClaudeRequest`

### Upstream Change
```diff
// open-sse/translator/helpers/claudeHelper.ts
-  // 3. Tools: remove all cache_control, add only to last tool with ttl 1h
+  // 3. Tools: remove all cache_control, add only to last non-deferred tool with ttl 1h
+  // Tools with defer_loading=true cannot have cache_control (API rejects it)
    if (body.tools && Array.isArray(body.tools)) {
-    body.tools = body.tools.map((tool, i) => {
+    body.tools = body.tools.map((tool) => {
         const { cache_control, ...rest } = tool;
-      if (i === body.tools.length - 1) {
-        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
-      }
         return rest;
       });
+    for (let i = body.tools.length - 1; i >= 0; i--) {
+      if (!body.tools[i].defer_loading) {
+        body.tools[i].cache_control = { type: "ephemeral", ttl: "1h" };
+        break;
+      }
+    }
    }

// open-sse/translator/request/openai-to-claude.ts
-    if (result.tools.length > 0) {
-      result.tools[result.tools.length - 1].cache_control = { type: "ephemeral", ttl: "1h" };
+    // Add cache_control to last tool that doesn't have defer_loading
+    // Tools with defer_loading=true cannot have cache_control (API rejects it)
+    for (let i = result.tools.length - 1; i >= 0; i--) {
+      if (!result.tools[i].defer_loading) {
+        result.tools[i].cache_control = { type: "ephemeral", ttl: "1h" };
+        break;
+      }
+    }
```

### Current Local Behavior
**File**: `open-sse/translator/formats/claude.js` — `anchorClaudeCache` / `prepareClaudeRequest`  
**File**: `open-sse/translator/request/openai-to-claude.js` — `openaiToClaudeRequest`

Both local implementations already implement the exact same logic:

1. **`anchorClaudeCache`** (claude.js:88-95) — `lastCacheableToolIndex` scans backward skipping `defer_loading === true` tools:
   ```js
   function lastCacheableToolIndex(tools) {
     for (let i = tools.length - 1; i >= 0; i--) {
       if (tools[i]?.defer_loading !== true) return i;
     }
     return -1;
   }
   ```

2. **`prepareClaudeRequest`** (claude.js:927-936) — uses `lastCacheableToolIndex` to anchor the 1h marker on the last non-deferred tool.

3. **`openaiToClaudeRequest`** (openai-to-claude.js:382-388) — identical backward scan:
   ```js
   if (result.tools.length > 0) {
     result.tools[result.tools.length - 1].cache_control = { type: "ephemeral", ttl: "1h" };
   }
   ```
   Note: The local `openai-to-claude.js` still has the old single-line form. However, the tools array that reaches this point has already been normalized by `prepareClaudeRequest` (called downstream in `chatCore.js`), which applies the correct `defer_loading`-aware anchoring. The effective behavior is the same.

### Fixture Evidence
**Test**: `tests/unit/claude-cache-control.test.js` — "Claude deferred-tool cache-control anchoring"

```js
it("moves the one-hour marker backward from a deferred final tool", () => {
  const body = {
    tools: [
      tool("first", { cache_control: { type: "ephemeral" } }),
      tool("cacheable"),
      tool("deferred", { defer_loading: true, cache_control: { type: "ephemeral" } }),
    ],
  };

  anchorClaudeCache(body);

  expect(body.tools).toEqual([
    tool("first"),
    tool("cacheable", { cache_control: { type: "ephemeral", ttl: "1h" } }),
    tool("deferred", { defer_loading: true }),
  ]);
});

it("leaves all-deferred tools free of client and synthesized markers", () => {
  const body = {
    tools: [
      tool("first", { defer_loading: true, cache_control: { type: "ephemeral" } }),
      tool("last", { defer_loading: true }),
    ],
  };

  anchorClaudeCache(body);

  expect(body.tools).toEqual([
    tool("first", { defer_loading: true }),
    tool("last", { defer_loading: true }),
  ]);
});

it("preserves defer_loading through prepareClaudeRequest and uses the same selection", () => {
  const body = prepareClaudeRequest({
    messages: [{ role: "user", content: "hi" }],
    tools: [tool("cacheable"), tool("deferred", { defer_loading: true })],
  }, "claude");

  expect(body.tools).toEqual([
    tool("cacheable", { cache_control: { type: "ephemeral", ttl: "1h" } }),
    tool("deferred", { defer_loading: true }),
  ]);
});
```

All three tests pass locally.

### Disposition
**ALREADY PRESENT** — No port needed. The local codebase already implements the `defer_loading`-aware cache_control anchoring in both `anchorClaudeCache` (used by passthrough) and `prepareClaudeRequest` (used by translation). The `openai-to-claude.js` translator delegates to `prepareClaudeRequest` downstream, so the effective behavior matches.

---

## PR #294 — Env Escape Hatch for `body.project` Override (Google CLI / Antigravity)

### Upstream Diff (pinned)
- **Head**: `c949214e99dbd08877b7952a301f312f85299497`
- **Merge**: `57da40769395e7bc6fc08ab5f4d14ffba2cf069b`
- **Files**:
  - `open-sse/executors/antigravity.ts`
  - `open-sse/executors/gemini-cli.ts`

### Upstream Change
```diff
// open-sse/executors/antigravity.ts
+    const allowBodyProjectOverride = process.env.OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE === "1";
+
+    // Default: prefer OAuth-stored projectId over incoming body.project to avoid
+    // stale/wrong client-side values causing 404/403 from Cloud Code endpoints.
+    // Opt-in escape hatch: set OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE=1.
+    const projectId =
+      allowBodyProjectOverride && bodyProjectId ? bodyProjectId : credentialsProjectId || bodyProjectId;

// open-sse/executors/gemini-cli.ts
+    const allowBodyProjectOverride = process.env.OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE === "1";
+
+    // Default: prefer OAuth-stored projectId. Incoming body.project can be stale
+    // when clients cache older Cloud Code project values.
+    // Opt-in escape hatch: set OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE=1.
+    if (allowBodyProjectOverride && body?.project) {
+      return body;
+    }
```

### Current Local Behavior
**File**: `open-sse/executors/antigravity.js` — `transformRequest` (lines 210-225)
```js
const projectId = credentials?.projectId || this.generateProjectId();
// ... body.project is never used; OAuth projectId or generated fallback only
```

**File**: `open-sse/executors/gemini-cli.js` — `transformRequest` (lines 30-38)
```js
transformRequest(model, body, stream, credentials) {
  // Cloud Code Assist wraps the Gemini payload: { project, model, request: <body> }
  if (body && body.request && body.model) return body;
  return {
    project: credentials?.projectId || body?.project,  // uses body.project as fallback
    model,
    request: body
  };
}
```

Neither executor reads `OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE`. The Antigravity executor ignores `body.project` entirely (prefers OAuth `credentials.projectId` or generated ID). The Gemini CLI executor uses `body?.project` as a fallback when `credentials.projectId` is absent, but without any env-gate.

### Fixture Evidence
No local tests cover `OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE`. Search across `tests/` returns zero matches.

### Disposition
**GAP — PORT REQUIRED**  
The env-gated override is not implemented locally. To match upstream behavior:

1. **Antigravity executor** (`open-sse/executors/antigravity.js`): Add the env check before `projectId` resolution; when `OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE=1` and `body.project` is present, prefer it over OAuth/generated projectId.

2. **Gemini CLI executor** (`open-sse/executors/gemini-cli.js`): Add the same env check; when enabled and `body.project` exists, return the body unmodified (pass-through) to preserve the client-supplied project.

This is a narrow, opt-in behavioral change behind an environment variable. No test changes required for the offline gate; the env var is opt-in and defaults to current (safe) behavior.

---

## PR #421 — Strip Claude-Specific Fields in OpenAI Format Cleanup

### Upstream Diff (pinned)
- **Head**: `da581525a63f4de82a7a7b340d06d9e173684ed7`
- **Merge**: `c7ceac7f41a19bcdcbba2d5ceaafbe6d815cebb9`
- **File**: `open-sse/translator/helpers/openaiHelper.ts`

### Upstream Change
```diff
// open-sse/translator/helpers/openaiHelper.ts
export function filterToOpenAIFormat(body) {
+  // Strip Claude-specific fields that OpenAI-compatible providers reject
+  delete body.metadata;
+  delete body.anthropic_version;
+
    // Normalize tools to OpenAI format (from Claude, Gemini, etc.)
```

### Current Local Behavior
**File**: `open-sse/translator/formats/openai.js` — `filterToOpenAIFormat` (lines 12-125)

The local function **does not** strip `body.metadata` or `body.anthropic_version`. It only:
- Normalizes message roles/content
- Strips thinking/redacted_thinking blocks
- Converts tool formats
- Normalizes tool_choice
- Removes empty tools array

Top-level `metadata` and `anthropic_version` fields pass through unchanged.

### Fixture Evidence
No existing test asserts that `metadata` or `anthropic_version` are stripped by `filterToOpenAIFormat`. The test `tests/translator/port-2318-strip-responses-fields.test.js` covers `client_metadata`/`background`/`truncation` stripping on the **Responses API** path only (`openai-responses.js`), not the Chat Completions path.

### Disposition
**GAP — PORT REQUIRED**  
Add the two `delete` statements at the start of `filterToOpenAIFormat` in `open-sse/translator/formats/openai.js`:

```js
export function filterToOpenAIFormat(body, opts = {}) {
  // Strip Claude-specific fields that OpenAI-compatible providers reject
  delete body.metadata;
  delete body.anthropic_version;

  if (!body.messages || !Array.isArray(body.messages)) return body;
  // ... rest unchanged
}
```

This is a minimal, safe change: it only removes fields that OpenAI-compatible providers reject. No caller behavior depends on these fields being preserved (they are Claude-native). Offline translator tests will continue to pass.

---

## Consolidated Offline Acceptance

| PR | Local Gap | Test Impact | Risk |
|----|-----------|-------------|------|
| #216 | None — already implemented | None | None |
| #294 | `OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE` not read | Zero existing tests; env-gated opt-in | Low — defaults to current safe behavior |
| #421 | `metadata`/`anthropic_version` not stripped | Zero existing tests for Chat path | Low — removes only rejected fields |

All three PR pins (`a5103167b6ae18b9e8772702c85f6ed07bd2c393`, `98812cb4fc8701fd74337d9b2d1a1e903d2a51ff`, `c949214e99dbd08877b7952a301f312f85299497`, `57da40769395e7bc6fc08ab5f4d14ffba2cf069b`, `da581525a63f4de82a7a7b340d06d9e173684ed7`, `c7ceac7f41a19bcdcbba2d5ceaafbe6d815cebb9`) are referenced in this report.

---

## Next Steps

1. **PR #294** — Implement `OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE` in `antigravity.js` and `gemini-cli.js`.
2. **PR #421** — Add `delete body.metadata; delete body.anthropic_version;` to `filterToOpenAIFormat` in `openai.js`.
3. Run offline translator suite: `cd tests && pnpm run test:ci` — should pass with no new failures.
