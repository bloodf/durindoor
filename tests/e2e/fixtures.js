// H1 fixture contract. H0a owns the contained runtime, authentication, and
// audit. H1 only consumes runtime.seed/reset/authenticate/recordBrowserRequest
// plus a context-level route deny that confines every browser request to the
// exact runtime origin (or inert data:/about: schemes). Storybook mode rejects
// seed/reset/authenticate because H0's Storybook slot has no mutable app DB.
//
// Pure helpers (URL validation, path containment) live in ./boundaries.mjs so
// Vitest can load them without booting the Playwright runtime. This module
// stays glue-only.
//
// The built-in `context` fixture is overridden so the destination guard wraps
// every test context. Built-in `page` derives from `context`, so any spec that
// destructures `{ page }` from the test args still gets a guarded page — there
// is no path through fixtures that hands a spec an unguarded browser.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { startQa } from "./runtime.mjs";
import { isAllowedDestination, safeArtifactPath, parseProjectName, validatedQaHardDir } from "./boundaries.mjs";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(sourceDir, "..", "..");
const storybookMode = () => process.env.DURINDOOR_QA_MODE === "storybook";

// Fixed controls. qa.assertNoExternalEffects drives every entry through the
// guarded browser context before asking H0 to validate its audit, proving
// each deny was observed (and the runtime-origin allow) instead of merely
// trusting an empty network log. `allow-runtime-origin` is a positive label
// the guard attaches to any request whose origin matches `runtime.baseUrl`.
const forbiddenControls = [
  { label: "deny-public-origin", url: "https://qa-forbidden.example.invalid/control" },
  { label: "deny-instance-metadata", url: "http://169.254.169.254/latest/meta-data" },
  { label: "deny-host-gateway", url: "http://host.docker.internal:43123/control" },
];

function requestLabel(url, baseURL, fallback) {
  const match = forbiddenControls.find((control) => control.url === url);
  if (match) return match.label;
  // Positive control: any request to the exact runtime origin records as
  // `allow-runtime-origin` so H0 can prove the allow path was observed,
  // not just the deny paths.
  if (typeof baseURL === "string" && baseURL.length > 0) {
    try {
      if (new URL(url).origin === new URL(baseURL).origin) return "allow-runtime-origin";
    } catch {
      // fall through to default
    }
  }
  return fallback;
}

/**
 * Build a per-test runtime directory inside the container, namespaced by
 * invocation, project, worker index, and a UUID nonce. Validation happens
 * only when a worker launches, leaving `playwright --list` side-effect free.
 */
function buildRunDir(projectName, workerIndex) {
  const nonce = randomUUID();
  const invocationRoot = validatedQaHardDir(ROOT, process.env.DURIN_QA_HARD_DIR);
  return {
    nonce,
    runDir: path.join(invocationRoot, `${projectName}-w${workerIndex}-${nonce}`),
    runsRoot: invocationRoot,
  };
}

/**
 * Install the deny-and-record guard on a context, not a single page, so
 * popups, downloads, and post-login redirects cannot escape the runtime
 * origin. The guard records every request (allowed and denied) with a
 * stable kind/label so the host-side assertNoExternalEffects can verify
 * that no observed request slipped past the policy. The returned detach
 * awaits `unroute` so a reused context never inherits stale routes.
 */
async function installDestinationGuard(context, runtime, label) {
  const baseURL = runtime.baseUrl;
  const handler = async (route) => {
    const url = route.request().url();
    const allowed = isAllowedDestination(url, baseURL);
    await runtime.recordBrowserRequest({
      kind: "network",
      label: requestLabel(url, baseURL, label),
      ok: allowed,
      detail: { url, status: allowed ? "allowed" : "denied" },
    });
    if (allowed) await route.fallback();
    else await route.abort("blockedbyclient");
  };
  await context.route("**/*", handler);
  return async () => {
    await context.unroute("**/*", handler);
  };
}

export const test = base.extend({
  // Worker-scoped: one contained runtime per worker. The runtime outlives
  // every test in the worker so startQa is not duplicated per case, and
  // stop() is invoked exactly once in the worker teardown.
  runtime: [async ({}, use, testInfo) => {
    if (testInfo.project.name === undefined) {
      throw new Error("Playwright project name required for runtime isolation");
    }
    const workerId = String(testInfo.workerIndex);
    const mode = storybookMode() ? "storybook" : "app";
    const { runDir } = buildRunDir(testInfo.project.name, workerId);
    const runtime = await startQa({ runDir, workerId, mode });
    try {
      await use(runtime);
    } finally {
      await runtime.stop();
    }
  }, { scope: "worker" }],

  // Distinct, untraced context for the auth bootstrap so the password
  // never lands in a trace or screenshot. Tear it down before handing its
  // storageState to tests: keeping it open through worker lifetime leaves an
  // unnecessary authenticated page/context alive beside every test context.
  _authState: [async ({ runtime, browser }, use) => {
    if (storybookMode()) {
      await use(undefined);
      return;
    }
    const context = await browser.newContext({ serviceWorkers: "block" });
    let detach = null;
    let page = null;
    try {
      detach = await installDestinationGuard(context, runtime, "auth-bootstrap");
      page = await context.newPage();
      const result = await runtime.authenticate(page);
      if (!result?.storageState) {
        throw new Error("authenticate did not return a private storageState");
      }
      await page.close();
      page = null;
      await detach();
      detach = null;
      await context.close();
      await use(result.storageState);
    } finally {
      if (page) await page.close().catch(() => {});
      if (detach) await detach();
      await context.close().catch(() => {});
    }
  }, { scope: "worker" }],

  // Built-in storageState is test-scoped. Source it from the worker-private
  // authenticated context so the password never reaches a test context.
  storageState: [async ({ _authState }, use) => use(_authState), { scope: "test" }],

  // Override the built-in `context` so every spec — including the implicit
  // { page } path — receives a guarded test context. Built-in `page` derives
  // from `context`, so this single override propagates the guard without
  // forcing specs to consume `qa` directly. Inheriting the built-in fixture
  // preserves every matrix option (viewport, colorScheme, isMobile, hasTouch,
  // screen, storageState) without re-implementing newContext.
  context: [async ({ context, runtime }, use) => {
    const detach = await installDestinationGuard(context, runtime, "test");
    try {
      await use(context);
    } finally {
      await detach();
    }
  }, { scope: "test" }],

  // Test-scoped facade. Does not allocate a browser; it consumes the guarded
  // built-in `page`/`context` and exposes the H0a mutation/audit wrappers.
  qa: async ({ runtime, page, context }, use, testInfo) => {
    const project = parseProjectName(testInfo.project.name);
    const mode = storybookMode() ? "storybook" : "app";
    const baseURL = runtime.baseUrl;
    const { dataDir, artifactDir } = runtime;
    const controlled = (method) => {
      if (typeof runtime[method] !== "function") {
        throw new Error(`H0 runtime must provide ${method}() to coordinate isolated DB lifecycle`);
      }
      return runtime[method].bind(runtime);
    };

    const qa = {
      baseURL,
      dataDir,
      artifactDir,
      workerId: String(testInfo.workerIndex),
      project,
      mode,
      page,
      context,
      // Storybook mode throws so a green test can never mask a missing
      // mutation runtime. App mode delegates to the H0a wrapper.
      seed: (scenario) => mode === "storybook"
        ? Promise.reject(new Error("seed unavailable in Storybook mode"))
        : controlled("seed")({ scenario }),
      reset: (options = {}) => mode === "storybook"
        ? Promise.reject(new Error("reset unavailable in Storybook mode"))
        : controlled("reset")({ preserveAuth: options.preserveAuth !== false }),
      artifactPath: (name) => safeArtifactPath(artifactDir, name),
      async assertNoExternalEffects() {
        // Separate guarded page uses native fetch, not Storybook's in-memory
        // fixture interceptor. Probe errors never contaminate the UI console.
        const probe = await context.newPage();
        try {
          await probe.evaluate(async (controls) => {
            await Promise.all(controls.map(async ({ url }) => {
              try { await fetch(url, { mode: "no-cors", cache: "no-store" }); }
              catch { /* The context boundary must deny these requests. */ }
            }));
          }, forbiddenControls);
          await runtime.assertNoExternalEffects();
        } finally { await probe.close(); }
      },
      async authenticate(authPage) {
        if (mode === "storybook") {
          throw new Error("authenticate unavailable in Storybook mode");
        }
        // Test pages inherit worker-private storageState. This traced facade
        // must only verify/reuse that session; password entry stays confined
        // to the untraced bootstrap context in _authState.
        const status = await authPage.request.get(`${baseURL}/api/auth/status`).then((r) => r.json()).catch(() => null);
        if (status?.authenticated !== true) {
          throw new Error("authenticated worker session missing; start a fresh QA runtime");
        }
        return { storageState: await authPage.context().storageState(), baseURL };
      },
    };
    await use(qa);
  },
});

// Password-entry, auth-failure, and secret-reveal specs must import this so
// their trace, screenshot, and video capture are all forced off. A spec that
// forgets this fixture may still load, but Playwright will surface the
// unredacted trace through its artifact directory; H0's audit still records
// the request.
export const authSensitiveTest = test.extend({ trace: "off", screenshot: "off", video: "off" });
export { expect };
