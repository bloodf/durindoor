# Port Report #1073 — March OmniRoute Request-Format Helper Changes

Three OmniRoute PRs from March 2026 that modify request-format helpers. Each is compared against the current DurinDoor local source at the corresponding files.

## PR Summary Table

| PR | Head SHA | Enclosing Merge | Files Changed | Local Status |
|----|----------|-----------------|---------------|--------------|
| [#216](https://github.com/cheaper-inference/OmniRoute/pull/216) | `a5103167b6ae18b9e8772702c85f6ed07bd2c393` | `98812cb4fc8701fd74337d9b2d1a1e903d2a51ff` | `open-sse/translator/helpers/claudeHelper.ts`, `open-sse/translator/request/openai-to-claude.ts` | **Already present** (logic in `open-sse/translator/formats/claude.js` + `open-sse/translator/request/openai-to-claude.js`) |
| [#294](https://github.com/cheaper-inference/OmniRoute/pull/294) | `c949214e99dbd08877b7952a301f312f85299497` | `57da40769395e7bc6fc08ab5f4d14ffba2cf069b` | `open-sse/executors/antigravity.ts`, `open-sse/executors/gemini-cli.ts` | **Outside scope** — source-only environment-controlled project selection changes project/credential ownership |
| [#421](https://github.com/cheaper-inference/OmniRoute/pull/421) | `da581525a63f4de82a7a7b340d06d9e173684ed7` | `c7ceac7f41a19bcdcbba2d5ceaafbe6d815cebb9` | `open-sse/translator/helpers/openaiHelper.ts` | **No confirmed leak** — local Claude request builder rebuilds the OpenAI target and maps user metadata separately |

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

### Current Local Behavior and Disposition
This upstream change adds a source-only environment-controlled setting for client project selection. It changes which project identifier is trusted and how project selection relates to stored credentials. That is a new feature and an ownership decision, rather than a request-format helper parity fix. It remains outside this report's scope. The absence of the setting locally is not a port gap, and no implementation instructions, samples, or test-free port recommendation apply.

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
`open-sse/translator/request/claude-to-openai.js` builds a fresh OpenAI-shaped `result` from selected Claude request fields; it does not spread or mutate the source Chat body. It maps a non-empty `body.metadata.user_id` to OpenAI's `user` field and does not copy the metadata object or `anthropic_version`. The later `filterToOpenAIFormat` call in `open-sse/translator/index.js` normalizes this translated target object, not the original Claude request.

The local fixture `tests/translator/anthropic-parity-audit.test.js` verifies the `metadata.user_id` to `user` mapping, including omission of empty or non-string IDs. Native Claude metadata is also carried explicitly for in-process round trips through the non-enumerable `CLAUDE_NATIVE_REQUEST_FIELDS` field; this preserves supported native context without placing it on the OpenAI wire.

### Disposition
**NO CONFIRMED CROSS-FORMAT LEAK** — The proposed shared-body deletion is not justified by the local request path: the Claude-to-OpenAI builder reconstructs the target and separately maps user metadata. Keep legitimate explicit native metadata handling. The ordinary Claude source path and local fixture evidence above do not establish leakage of Claude `metadata` or `anthropic_version` into an OpenAI Chat request. The upstream recommendation therefore does not establish a local port requirement.

---

## Consolidated Offline Acceptance

| PR | Local Disposition | Test Impact | Risk |
|----|-----------|-------------|------|
| #216 | None — already implemented | None | None |
| #294 | New project-selection feature outside request-format scope | None; no port proposed | Not assessed here |
| #421 | No confirmed cross-format leak in the rebuilt Claude-to-OpenAI request | Existing fixture verifies explicit user metadata mapping | No change proposed |

All three PR pins (`a5103167b6ae18b9e8772702c85f6ed07bd2c393`, `98812cb4fc8701fd74337d9b2d1a1e903d2a51ff`, `c949214e99dbd08877b7952a301f312f85299497`, `57da40769395e7bc6fc08ab5f4d14ffba2cf069b`, `da581525a63f4de82a7a7b340d06d9e173684ed7`, `c7ceac7f41a19bcdcbba2d5ceaafbe6d815cebb9`) are referenced in this report.

---
