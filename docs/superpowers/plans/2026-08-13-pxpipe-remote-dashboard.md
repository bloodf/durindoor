# PXPIPE Remote Dashboard Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore accurate, fully functional PXPIPE controls for authenticated dashboards reached through a reverse proxy without exposing PXPIPE management when dashboard login is disabled.

**Architecture:** Add a dedicated PXPIPE branch to the deny-by-default dashboard guard. Direct local access retains the operator's `requireLogin` policy, while every non-local request requires a dashboard JWT or machine-bound CLI token. Keep API failures distinct from dependency absence with one pure UI-state classifier shared by `TokenSaverClient` and its unit test.

**Tech Stack:** Next.js 16 route guard, React 19 client component, Vitest 4, Node.js 20.20.2, npm 10.8.2.

## Global Constraints

- Every proxied/non-local `/api/pxpipe` request requires a valid dashboard JWT or CLI token even when `requireLogin=false`.
- Direct local no-login access remains available when the operator explicitly disables login.
- API keys do not grant PXPIPE management access.
- PXPIPE remains a bundled in-process dependency; never add runtime package installation or shell execution.
- A status request failure renders `Unavailable` with its diagnostic, never `Not installed` or reinstall advice.
- `installed === false` remains the only dependency-missing signal.
- Do not modify `tests/__baseline__/known-fails.txt`.
- Update operator documentation and unit coverage in the same PR.

---

### Task 1: Enforce PXPIPE-specific remote authentication

**Files:**
- Modify: `src/dashboardGuard.js:73-91,258-350`
- Modify: `tests/unit/dashboard-guard.test.js:279-315`

**Interfaces:**
- Consumes: existing `isLocalRequest(request)`, `hasValidCliToken(request)`, `hasValidToken(request)`, and `isAuthenticated(request)` helpers.
- Produces: `isPxpipePath(pathname): boolean` and `canAccessPxpipeRoute(request): Promise<boolean>` used only by `proxy(request)`.

- [ ] **Step 1: Replace the obsolete local-only expectations with failing PXPIPE authorization tests**

In `tests/unit/dashboard-guard.test.js`, remove the parameterized test that expects both `/api/pxpipe/start` and `/api/pxpipe/status` to return the local-only 403. Add these cases inside `describe("dashboard guard local-only access", ...)`:

```js
it("allows an authenticated proxied dashboard to manage PXPIPE", async () => {
  mocks.getSettings.mockResolvedValue({ requireLogin: false });
  mocks.verifyDashboardAuthToken.mockResolvedValue(true);
  const req = request("/api/pxpipe/status", {
    host: "llm.example.com",
    "x-9r-via-proxy": "1",
  });
  req.cookies.get = vi.fn((name) =>
    name === "auth_token" ? { value: "valid-jwt" } : undefined,
  );

  const response = await proxy(req);

  expect(response).toBe(mocks.nextResponse);
  expect(mocks.verifyDashboardAuthToken).toHaveBeenCalledWith("valid-jwt");
});

it("rejects an unauthenticated proxied PXPIPE request when login is disabled", async () => {
  mocks.getSettings.mockResolvedValue({ requireLogin: false });

  const response = await proxy(request("/api/pxpipe/status", {
    host: "llm.example.com",
    "x-9r-via-proxy": "1",
  }));

  expect(response.status).toBe(401);
  expect(response.body.error).toBe("Unauthorized");
});

it("preserves local PXPIPE access when login is disabled", async () => {
  mocks.getSettings.mockResolvedValue({ requireLogin: false });

  const response = await proxy(request("/api/pxpipe/status", {
    host: "localhost:20128",
    origin: "http://localhost:20128",
    "x-9r-real-ip": "127.0.0.1",
  }));

  expect(response).toBe(mocks.nextResponse);
});

it("allows a machine-bound CLI token to manage proxied PXPIPE", async () => {
  const response = await proxy(request("/api/pxpipe/restart", {
    host: "llm.example.com",
    "x-9r-via-proxy": "1",
    "x-9r-cli-token": "cli-token",
  }, "POST"));

  expect(response).toBe(mocks.nextResponse);
});
```

- [ ] **Step 2: Run the guard test and confirm the authenticated remote case is red**

Run from `tests/`:

```bash
PATH="$HOME/.local/node20/bin:$PATH" \
  /home/cortexos/Developer/github.com/bloodf/durindoor/tests/node_modules/.bin/vitest \
  run --config vitest.config.js unit/dashboard-guard.test.js
```

Expected: the authenticated proxied case fails because current code returns HTTP 403 instead of `mocks.nextResponse`; the unauthenticated case also reports 403 instead of the designed 401.

- [ ] **Step 3: Add the dedicated PXPIPE authorization branch**

In `src/dashboardGuard.js`, remove `"/api/pxpipe"` from `LOCAL_ONLY_PATHS` and add these helpers after `isAuthenticated`:

```js
function isPxpipePath(pathname) {
  return pathname === "/api/pxpipe" || pathname.startsWith("/api/pxpipe/");
}

async function canAccessPxpipeRoute(request) {
  if (await hasValidCliToken(request)) return true;
  if (isLocalRequest(request)) return await isAuthenticated(request);
  return await hasValidToken(request);
}
```

Inside `proxy(request)`, immediately after the `/api/mcp/control` branch and before `LOCAL_ONLY_PATHS`, add:

```js
if (isPxpipePath(pathname)) {
  if (await canAccessPxpipeRoute(request)) return NextResponse.next();
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

Add `isPxpipePath` and `canAccessPxpipeRoute` to `__test__` only if direct helper assertions are needed; the route-level tests above are sufficient and preferred.

- [ ] **Step 4: Run the focused guard test green**

Run the Step 2 command again.

Expected: `unit/dashboard-guard.test.js` passes, including authenticated proxy, unauthenticated proxy with `requireLogin=false`, local no-login, and CLI-token cases.

- [ ] **Step 5: Commit the authorization contract**

```bash
git add src/dashboardGuard.js tests/unit/dashboard-guard.test.js
git commit -m "fix(pxpipe): authenticate remote dashboard controls"
```

---

### Task 2: Stop both dashboard views from classifying status errors as missing dependencies

**Files:**
- Create: `src/app/(dashboard)/dashboard/pxpipe/pxpipeStatus.js`
- Create: `tests/unit/pxpipe-status-view.test.js`
- Modify: `src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js:3-8,27-33,262-278,449-459,724-746`
- Modify: `src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.js:1-8,52-78,113-150`

**Interfaces:**
- Produces: `getPxpipeStatusView(status, health): { label: string, dependencyMissing: boolean, error: string | null }`.
- Consumes: PXPIPE status JSON and health JSON already held by both `TokenSaverClient` and `PxpipeClient`.

- [ ] **Step 1: Write failing unit tests for shared status classification**

Create `tests/unit/pxpipe-status-view.test.js`:

```js
import { describe, expect, it } from "vitest";
import { getPxpipeStatusView } from "../../src/app/(dashboard)/dashboard/pxpipe/pxpipeStatus.js";

describe("PXPIPE status view", () => {
  it("keeps an API failure distinct from a missing dependency", () => {
    expect(getPxpipeStatusView(
      { error: "Local only: CLI token required", loading: false },
      { healthy: false, error: "Local only: CLI token required" },
    )).toEqual({
      label: "Unavailable",
      dependencyMissing: false,
      error: "Local only: CLI token required",
    });
  });

  it("shows repair guidance only for an explicit missing dependency", () => {
    expect(getPxpipeStatusView(
      { installed: false, loading: false },
      null,
    )).toEqual({
      label: "Not installed",
      dependencyMissing: true,
      error: null,
    });
  });

  it.each([
    [{ loading: true }, null, "Checking…"],
    [{ installing: true }, null, "Installing…"],
    [{ installed: true, running: true }, { healthy: true }, "Healthy"],
    [{ installed: true, running: true }, { healthy: false }, "Running"],
    [{ installed: true, running: false }, { healthy: false }, "Stopped"],
  ])("classifies the supplied state", (status, health, label) => {
    expect(getPxpipeStatusView(status, health).label).toBe(label);
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails because the shared helper does not exist**

Run from `tests/`:

```bash
PATH="$HOME/.local/node20/bin:$PATH" \
  /home/cortexos/Developer/github.com/bloodf/durindoor/tests/node_modules/.bin/vitest \
  run --config vitest.config.js unit/pxpipe-status-view.test.js
```

Expected: FAIL resolving `dashboard/pxpipe/pxpipeStatus.js`.

- [ ] **Step 3: Implement the pure status-view helper**

Create `src/app/(dashboard)/dashboard/pxpipe/pxpipeStatus.js`:

```js
export function getPxpipeStatusView(status = {}, health = null) {
  const error = typeof status.error === "string" && status.error.trim()
    ? status.error.trim()
    : null;
  if (error) return { label: "Unavailable", dependencyMissing: false, error };
  if (status.loading) return { label: "Checking…", dependencyMissing: false, error: null };
  if (status.installing) return { label: "Installing…", dependencyMissing: false, error: null };
  if (health?.healthy) return { label: "Healthy", dependencyMissing: false, error: null };
  if (status.running) return { label: "Running", dependencyMissing: false, error: null };
  if (status.installed === true) return { label: "Stopped", dependencyMissing: false, error: null };
  return {
    label: "Not installed",
    dependencyMissing: status.installed === false,
    error: null,
  };
}
```

Run the Step 2 command again.

Expected: `unit/pxpipe-status-view.test.js` passes.

- [ ] **Step 4: Make the Token Saver settings card preserve HTTP failures**

Import the helper in `TokenSaverClient.js`:

```js
import { getPxpipeStatusView } from "../pxpipe/pxpipeStatus.js";
```

Replace `refreshPxpipeStatus` with:

```js
const refreshPxpipeStatus = useCallback(async () => {
  setPxpipeStatus((s) => ({ ...s, loading: true, error: null }));
  try {
    const res = await fetch("/api/pxpipe/status", {
      headers: { "Cache-Control": "no-store" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = data.error || `PXPIPE status failed (${res.status})`;
      setPxpipeStatus({ error, loading: false });
      return;
    }
    setPxpipeStatus({ ...data, error: null, loading: false });
    if (typeof data.minChars === "number") {
      const v = String(data.minChars);
      setPxpipeMinChars(v);
      setPxpipeInputValue(v);
    }
  } catch (error) {
    setPxpipeStatus({ error: error.message, loading: false });
  }
}, []);
```

Replace the nested `pxpipeStatusLabel` expression with:

```js
const pxpipeStatusView = getPxpipeStatusView(pxpipeStatus, pxpipeHealth);
const pxpipeStatusLabel = pxpipeStatusView.label;
```

Use `pxpipeStatusView.dependencyMissing` for the toggle title, toggle disabled state, and dependency-repair warning. Render `pxpipeStatusView.error` before the dependency warning:

```jsx
{pxpipeStatusView.error ? (
  <p className="text-sm text-warning max-w-64">
    PXPIPE status unavailable: {pxpipeStatusView.error}
  </p>
) : pxpipeStatusView.dependencyMissing ? (
  <p className="text-sm text-warning max-w-64">
    PXPIPE dependency missing. Reinstall the application
    (npm install) to restore it.
  </p>
) : pxpipeStatus.running ? (
```

Keep the existing start/stop/restart branches after this condition unchanged.

- [ ] **Step 5: Make the PXPIPE overview/dashboard preserve the same HTTP failure**

Import the shared helper in `PxpipeClient.js`:

```js
import { getPxpipeStatusView } from "./pxpipeStatus.js";
```

Inside `refresh`, parse the status response with its HTTP result and retain a diagnostic:

```js
const statusData = await statusRes.json().catch(() => ({}));
setStatus(statusRes.ok
  ? { ...statusData, error: null }
  : { error: statusData.error || `PXPIPE status failed (${statusRes.status})` });
setStats(await statsRes.json());
setLogs(await logsRes.json());
const healthRes = await fetch("/api/pxpipe/health", { method: "POST" });
setHealth(await healthRes.json());
```

Change the catch block to retain transport errors:

```js
} catch (error) {
  setStatus({ error: error.message });
} finally {
```

Replace the nested `statusLabel` expression with:

```js
const statusView = getPxpipeStatusView(status || { loading }, health);
```

Use `statusView.label` as the Status summary value, `statusView.error` as its subtext when present, and `text-warning` as its tone when unavailable:

```jsx
<SummaryCard
  label="Status"
  value={statusView.label}
  tone={health?.healthy
    ? "text-success"
    : statusView.error || status?.installed
      ? "text-warning"
      : "text-text-muted"}
  sub={statusView.error || (status?.enabled ? "Enabled in pipeline" : "Disabled in pipeline")}
/>
```

- [ ] **Step 6: Run the PXPIPE UI-state and install-detection tests**

Run from `tests/`:

```bash
PATH="$HOME/.local/node20/bin:$PATH" \
  /home/cortexos/Developer/github.com/bloodf/durindoor/tests/node_modules/.bin/vitest \
  run --config vitest.config.js \
  unit/pxpipe-status-view.test.js \
  unit/pxpipe-install-detection.test.js
```

Expected: both files pass. The install-detection suite still proves a real package reports `installed: true`; the view suite proves an API error never becomes dependency missing in either consumer.

- [ ] **Step 7: Commit both UI corrections**

```bash
git add \
  'src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js' \
  'src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.js' \
  'src/app/(dashboard)/dashboard/pxpipe/pxpipeStatus.js' \
  tests/unit/pxpipe-status-view.test.js
git commit -m "fix(pxpipe): show remote status errors accurately"
```

---
### Task 3: Document and gate the corrected access model

**Files:**
- Modify: `docs/features/compression.md:86-90`
- Existing design: `docs/superpowers/specs/2026-08-13-pxpipe-remote-dashboard-design.md`

**Interfaces:**
- Documents the Task 1 authorization contract and Task 2 UI diagnostics.

- [ ] **Step 1: Update operator documentation**

Append this paragraph to `## PXPIPE installation model` in `docs/features/compression.md`:

```markdown
PXPIPE management endpoints follow a dedicated access rule. A dashboard reached through a reverse proxy must present a valid dashboard session or machine-bound CLI token even when `requireLogin` is disabled; API keys do not grant management access. Direct loopback access keeps the normal local `requireLogin` policy. An authorization or status-probe failure is shown as `Unavailable` and is not evidence that the bundled dependency needs reinstalling.
```

- [ ] **Step 2: Run focused tests together**

Run from `tests/`:

```bash
PATH="$HOME/.local/node20/bin:$PATH" \
  /home/cortexos/Developer/github.com/bloodf/durindoor/tests/node_modules/.bin/vitest \
  run --config vitest.config.js \
  unit/dashboard-guard.test.js \
  unit/pxpipe-status-view.test.js \
  unit/pxpipe-install-detection.test.js \
  unit/pxpipe-loader-dispatch.test.js \
  unit/pxpipe.test.js
```

Expected: all five files pass with no new known-failure baseline entries.

- [ ] **Step 3: Run repository gates serially**

From the worktree root, install with the pinned toolchain once, then run the gates serially:

```bash
PATH="$HOME/.local/node20/bin:$PATH" npm ci --no-audit --no-fund
cd tests
PATH="$HOME/.local/node20/bin:$PATH" npm ci --no-audit --no-fund
PATH="$HOME/.local/node20/bin:$PATH" npm run test:ci
cd ..
PATH="$HOME/.local/node20/bin:$PATH" npm run build
PATH="$HOME/.local/node20/bin:$PATH" npm run lint
```

Expected: dependency installation exits 0, the no-regression test gate has 0 raw failures, build exits 0, and lint has 0 errors. Do not add to `tests/__baseline__/known-fails.txt`.

- [ ] **Step 4: Commit documentation and validate commits**

```bash
git add docs/features/compression.md
git commit -m "docs(pxpipe): explain remote management authentication"
npx --no-install commitlint --from=origin/main --to=HEAD
```

Expected: commitlint exits 0.

---

### Task 4: Ship and verify the production repair

**Files:**
- PR branch: `fix/pxpipe-remote-dashboard`
- Release metadata after merge: `package.json`, `package-lock.json`, `cli/package.json`, `cli/package-lock.json`, `CHANGELOG.md`

**Interfaces:**
- Produces: merged fix PR, patch release `v3.15.2`, and deployed `/opt/cortexos/durindoor-fork` runtime.

- [ ] **Step 1: Push and open the fix PR**

Validate the title and push only the feature branch:

```bash
printf 'fix(pxpipe): restore authenticated remote dashboard controls\n' | npx --no-install commitlint
git push -u origin fix/pxpipe-remote-dashboard
```

Open a PR to `main` titled `fix(pxpipe): restore authenticated remote dashboard controls`. Its body must document scope, the 403-to-false-Not-installed reproduction, unit coverage, docs coverage, zero baseline growth, authentication behavior, and that no wire format or migration changes occur.

- [ ] **Step 2: Wait for all required workflows and resolve every review thread**

Require green commitlint, Lint & Build, and Vitest + No-regression checks. Verify reviewer comments against source; fix real findings, explain false positives, and leave zero unresolved threads before squash merge.

- [ ] **Step 3: Squash merge the fix PR**

Confirm the PR title passes commitlint immediately before merging. Squash merge into `main`; do not push directly to `main`.

- [ ] **Step 4: Cut patch release 3.15.2 from merged `origin/main`**

In a fresh release worktree, set root and CLI versions to `3.15.2`, update both lockfile root package versions, and prepend a `CHANGELOG.md` entry stating that authenticated proxied dashboards can manage PXPIPE and status authorization failures no longer appear as missing dependencies. Commit as:

```bash
git commit -m "chore(release): bump version to 3.15.2"
```

Open and merge a separate release PR after all three required workflows pass. Create GitHub release `v3.15.2` targeting the merged release commit.

- [ ] **Step 5: Deploy the exact tag and verify through both auth paths**

Deploy `v3.15.2` to `/opt/cortexos/durindoor-fork`, rebuild with the pinned Node 20/npm 10 toolchain, copy `open-sse` into standalone, align `better-sqlite3` with the service's actual Node ABI if necessary, and restart `durindoor.service`.

Verify:

```text
/api/version.currentVersion = 3.15.2
/api/pxpipe/status with CLI token: HTTP 200, installed=true, version=0.9.0
/api/pxpipe/health with CLI token: HTTP 200, healthy=true
proxied /api/pxpipe/status without JWT/CLI token and requireLogin=false: HTTP 401
proxied /api/pxpipe/status with dashboard JWT: HTTP 200
public dashboard card: Healthy · v0.9.0, no reinstall warning
start → stopped/running state transitions remain available to the authenticated dashboard
```

Also require `/v1/models` HTTP 200, one real chat completion HTTP 200, active service status, zero post-restart `Cannot find module`, `database disk image is malformed`, or `SQLite integrity check failed` journal entries, and a clean deployed checkout matching `v3.15.2`.
