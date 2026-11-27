// Operator setup helpers for the staged Firefly web UI flow (#2034), exported
// for a later registration change. Nothing routes to them yet.
//
// A setup session opens the connection's private profile in an ordinary,
// headed Chromium on the fixed Firefly origin, so the operator can sign in,
// pass any challenge and accept terms themselves. It needs an authenticated
// operator (supplied by that later integration), the enabled guard and an
// initialized profile, but no control mapping: the mapping is usually written
// after this step. The session navigates once and does nothing else: no
// typing, clicking, cookie, storage or token reads, and no export.
//
// Setup and generation are mutually exclusive per profile (409 busy). The
// human's context stays open until the operator closes it here or closes the
// window; generation never touches it.
import { randomUUID } from "node:crypto";
import { ADOBE_FIREFLY_WEB_ORIGIN } from "../../providers/private/adobe-firefly-web.js";
import { FIREFLY_WEB_UI_KEY, assertNoSuppliedSecrets, parseFireflyWebUiConfig, reject } from "./config.js";
import { acquireProfile, assertConnectionId, initializeProfile, resolveProfile } from "./profile.js";
import { SETUP_LAUNCH_OPTIONS, launchOwnedContext, playwrightLauncher } from "./browser.js";
import { isFunction } from "../../../src/shared/utils/typeChecks.js";

const sessions = new Map();

function assertOperator(operator) {
  if (operator?.authenticated !== true) throw reject(403, "Adobe Firefly web UI setup needs an authenticated operator", "forbidden");
}

const resolveDataDir = async (deps) => (isFunction(deps.dataDir) ? deps.dataDir() : deps.dataDir);

/**
 * Create the connection's private profile and return `{ profileHandle }` for
 * the caller to store. Refused when the connection already has a handle.
 */
export async function initializeFireflyWebUiProfile({ credentials, operator, deps = {} }) {
  assertOperator(operator);
  assertNoSuppliedSecrets(credentials);
  const existingHandle = credentials?.providerSpecificData?.[FIREFLY_WEB_UI_KEY]?.profileHandle;
  return initializeProfile({ dataDir: await resolveDataDir(deps), connectionId: assertConnectionId(credentials?.connectionId), existingHandle });
}

/**
 * Open a headed setup browser on the Firefly origin. Returns `{ setupId,
 * origin }`; nothing about the profile, its path or the session is returned.
 */
export async function openFireflyWebUiSetup({ credentials, operator, deps = {} }) {
  assertOperator(operator);
  const config = parseFireflyWebUiConfig(credentials, { purpose: "setup" });
  const connectionId = assertConnectionId(credentials?.connectionId);
  const dir = resolveProfile({ dataDir: await resolveDataDir(deps), connectionId, profileHandle: config.profileHandle });
  const release = acquireProfile(dir, "setup");
  let owned = null;
  try {
    owned = await launchOwnedContext(deps.launcher ?? playwrightLauncher, dir, SETUP_LAUNCH_OPTIONS);
    const page = owned.context.pages?.()[0] ?? (await owned.context.newPage());
    await page.goto(`${ADOBE_FIREFLY_WEB_ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: config.limits.navigationTimeoutMs });
  } catch {
    if (owned) await owned.close();
    release();
    throw reject(502, "Adobe Firefly web UI setup browser could not open the Firefly site", "failed");
  }
  const setupId = randomUUID();
  const finish = () => {
    if (!sessions.has(setupId)) return;
    sessions.delete(setupId);
    owned.close().finally(release);
  };
  sessions.set(setupId, { connectionId, finish });
  // The operator closing the window ends the session too.
  owned.context.on?.("close", finish);
  return { setupId, origin: ADOBE_FIREFLY_WEB_ORIGIN };
}

/** Close a setup session this process opened. Returns whether one was open. */
export function closeFireflyWebUiSetup(setupId) {
  const session = sessions.get(setupId);
  if (!session) return false;
  session.finish();
  return true;
}

export const openFireflyWebUiSetupIds = () => [...sessions.keys()];
