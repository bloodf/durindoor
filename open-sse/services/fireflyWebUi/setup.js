// Operator setup helpers for the registered experimental Firefly web UI flow.
// The dashboard connection route supplies authentication and stored ownership.
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
// window; generation never touches it. Deleting the connection first closes
// and awaits its own setup browser (retireFireflyWebUiSetup).
import { randomUUID } from "node:crypto";
import { ADOBE_FIREFLY_WEB_ORIGIN } from "../../providers/registry/adobe-firefly-web.js";
import { FIREFLY_WEB_UI_KEY, assertNoSuppliedSecrets, parseFireflyWebUiConfig, reject } from "./config.js";
import { acquireProfile, assertConnectionId, initializeProfile, resolveProfile } from "./profile.js";
import { SETUP_LAUNCH_OPTIONS, launchOwnedContext, playwrightLauncher } from "./browser.js";
import { isFunction } from "../../../src/shared/utils/typeChecks.js";

const sessions = new Map();
// Launches still in progress, per connection, so deletion can wait for them.
const pending = new Map();
// Connections being deleted (count of in-flight retirements) or already deleted.
const retiring = new Map();
const retired = new Set();
const CLOSE_TIMEOUT_MS = 10_000;

const closeBlocked = (connectionId) => retiring.has(connectionId) || retired.has(connectionId);

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
  if (closeBlocked(connectionId)) throw reject(409, "Adobe Firefly web UI connection is being deleted", "busy");
  // Registered in the same tick as the check: a deletion waits for this launch.
  let settle;
  const launching = new Promise((resolve) => { settle = resolve; });
  const list = pending.get(connectionId) ?? new Set();
  pending.set(connectionId, list.add(launching));
  try {
    return await launchSetup(connectionId, config, deps);
  } finally {
    list.delete(launching);
    if (!list.size && pending.get(connectionId) === list) pending.delete(connectionId);
    settle();
  }
}

/**
 * Launch, navigate and register one setup browser.
 *
 * Failed-start resource ownership: once a context exists it is owned by a
 * session record (see `ownSetupContext`) that holds the profile lock until the
 * browser is confirmed closed, by a successful `context.close()` or by the
 * context's own `close` event. When page creation or navigation fails, the
 * record is registered before any close attempt, so a concurrent or later
 * deletion still finds it after the pending-launch entry clears. The start
 * then tries one bounded close: on confirmation the record and lock are
 * released (exactly once) and the start reports 502; when the close fails or
 * times out the record and lock are kept, status stays `open`, a deletion
 * refuses with 502 `close_failed`, and a later explicit close or delete
 * retries. A launch that rejects before any context exists owns nothing.
 */
async function launchSetup(connectionId, config, deps) {
  const dir = resolveProfile({ dataDir: await resolveDataDir(deps), connectionId, profileHandle: config.profileHandle });
  const release = acquireProfile(dir, "setup");
  const failed = () => reject(502, "Adobe Firefly web UI setup browser could not open the Firefly site", "failed");
  let context;
  try {
    ({ context } = await launchOwnedContext(deps.launcher ?? playwrightLauncher, dir, SETUP_LAUNCH_OPTIONS));
  } catch {
    release();
    throw failed();
  }
  const session = ownSetupContext(connectionId, context, release);
  try {
    const page = context.pages?.()[0] ?? (await context.newPage());
    await page.goto(`${ADOBE_FIREFLY_WEB_ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: config.limits.navigationTimeoutMs });
  } catch {
    session.register();
    // Bounded: a close that fails or hangs leaves the session and lock held.
    await withTimeout(session.finish(), CLOSE_TIMEOUT_MS).catch(() => {});
    throw failed();
  }
  session.register();
  return { setupId: session.setupId, origin: ADOBE_FIREFLY_WEB_ORIGIN };
}

/**
 * Track ownership of a launched setup context. `register()` adds it to the
 * session map (no-op once confirmed closed). `finish()` closes it, awaiting
 * the context close itself (not the error-swallowing helper) so a failure is
 * visible; a close still in flight is reused, and a failed close can be
 * retried. Only a confirmed close (successful `close()` or the context `close`
 * event, which also covers the operator closing the window) removes the
 * session and releases the profile lock, exactly once.
 */
function ownSetupContext(connectionId, context, release) {
  const setupId = randomUUID();
  let closing = null;
  let confirmed = false;
  let signalClosed;
  const closedSignal = new Promise((resolve) => { signalClosed = resolve; });
  const confirm = () => {
    if (confirmed) return;
    confirmed = true;
    if (sessions.get(setupId)?.finish === finish) sessions.delete(setupId);
    release();
    signalClosed();
  };
  function finish() {
    if (confirmed) return Promise.resolve();
    closing ??= Promise.resolve()
      .then(() => context.close())
      .then(confirm, (error) => {
        closing = null;
        // A close event already proved the browser closed despite the error.
        if (!confirmed) throw error;
      });
    return Promise.race([closing, closedSignal]);
  }
  context.on?.("close", confirm);
  return {
    setupId,
    finish,
    register() {
      if (!confirmed) sessions.set(setupId, { connectionId, finish, closing: () => closing !== null });
    },
  };
}

/** Close a setup session this process opened. Returns whether one was open and not already closing. */
export function closeFireflyWebUiSetup(setupId) {
  const session = sessions.get(setupId);
  if (!session || session.closing()) return false;
  session.finish().catch(() => {});
  return true;
}

export const openFireflyWebUiSetupIds = () => [...sessions.keys()];

/** Status is local browser ownership only, never a claim of successful sign-in. */
export function fireflySetupStatus(connectionId) {
  const open = [...sessions.values()].some((session) => session.connectionId === connectionId);
  return { open, outcome: open ? "needs_operator" : "unknown", liveVerified: false };
}

/** Close only sessions owned by the route's stored connection. */
export function closeConnectionFireflySetup(connectionId) {
  let closed = false;
  for (const session of sessions.values()) {
    if (session.connectionId === connectionId && !session.closing()) { session.finish().catch(() => {}); closed = true; }
  }
  return closed;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, rejectTimeout) => { timer = setTimeout(() => rejectTimeout(new Error("close timed out")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Before a connection row is deleted: block new setup launches for it, wait
 * for its in-flight launches, then close and await every setup browser it
 * owns. Other connections are untouched. Throws a 502 `close_failed` (with
 * the block lifted and the sessions still registered) when any browser could
 * not be confirmed closed, so the caller must not delete the row. On success
 * returns `{ commit, abort }`: `commit()` after the row is gone keeps the
 * connection permanently blocked; `abort()` lifts the block if the row stays.
 */
export async function retireFireflyWebUiSetup(connectionId, { closeTimeoutMs = CLOSE_TIMEOUT_MS } = {}) {
  retiring.set(connectionId, (retiring.get(connectionId) ?? 0) + 1);
  let done = false;
  const lift = () => {
    if (done) return;
    done = true;
    const count = retiring.get(connectionId) - 1;
    if (count > 0) retiring.set(connectionId, count);
    else retiring.delete(connectionId);
  };
  try {
    const failed = () => reject(502, "Adobe Firefly web UI setup browser could not be closed; the connection was not deleted", "close_failed");
    // A launch that never settles cannot be proven closed; refuse the delete.
    await withTimeout(Promise.all([...(pending.get(connectionId) ?? [])]), closeTimeoutMs).catch(() => { throw failed(); });
    const owned = [...sessions.values()].filter((session) => session.connectionId === connectionId);
    const results = await Promise.allSettled(owned.map((session) => withTimeout(session.finish(), closeTimeoutMs)));
    if (results.some((result) => result.status === "rejected")) {
      throw failed();
    }
  } catch (error) {
    lift();
    throw error;
  }
  return {
    commit() { if (!done) retired.add(connectionId); lift(); },
    abort: lift,
  };
}
