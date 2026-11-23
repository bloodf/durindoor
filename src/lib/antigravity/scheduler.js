import { makeKv } from "../db/helpers/kvStore.js";
import { getAdapter } from "../db/driver.js";
import { getProviderConnections } from "../db/repos/connectionsRepo.js";
import { refreshAndUpdateCredentials } from "../../shared/services/providerCredentials.js";
import { isAntigravityProvider } from "./refreshProtocol.js";
import { observeExpiredAntigravityLeases } from "./leaseSql.js";
import { cleanupAntigravityBrowserProfiles } from "./browserRecovery.js";
import { publicCategory } from "./publicError.js";

const kv = makeKv("antigravityRotation");
const SCHEDULER_KEY = "scheduler";
const LEAD_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 1000;

let timer = null;
let ticking = false;

export async function readAntigravityScheduler() {
  const stored = await kv.get(SCHEDULER_KEY, { enabled: false });
  return { enabled: stored?.enabled === true };
}

export async function setAntigravitySchedulerEnabled(enabled) {
  const next = { enabled: enabled === true, updatedAt: new Date().toISOString() };
  await kv.set(SCHEDULER_KEY, next);
  if (!next.enabled) stopAntigravityScheduler();
  else startAntigravitySchedulerLoop();
  return { enabled: next.enabled };
}

export function stopAntigravityScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  ticking = false;
}

function startAntigravitySchedulerLoop() {
  if (timer) return;
  const safe = () => {
    runAntigravitySchedulerTick().catch(() => {});
  };
  timer = setInterval(safe, TICK_MS);
  timer.unref?.();
}

export async function resumeAntigravitySchedulerIfEnabled() {
  try {
    cleanupAntigravityBrowserProfiles();
    const db = await getAdapter();
    observeExpiredAntigravityLeases(db);
    const state = await readAntigravityScheduler();
    if (!state.enabled) return false;
    startAntigravitySchedulerLoop();
    return true;
  } catch {
    return false;
  }
}

function jitterMs(random = Math.random) {
  return Math.floor(random() * 30_001);
}

export function selectDueAntigravityConnection(connections, now, random = Math.random) {
  const due = [];
  for (const connection of connections || []) {
    if (!isAntigravityProvider(connection.provider) || connection.isActive === false) continue;
    if (!connection.refreshToken || !connection.expiresAt) continue;
    const expiresAt = Date.parse(connection.expiresAt);
    if (!Number.isFinite(expiresAt)) continue;
    if (expiresAt - now <= LEAD_MS + jitterMs(random)) due.push(connection);
  }
  return due[0] || null;
}

export async function runAntigravitySchedulerTick({
  now = Date.now(),
  listConnections = getProviderConnections,
  refresh = refreshAndUpdateCredentials,
  random = Math.random,
} = {}) {
  const state = await readAntigravityScheduler();
  if (!state.enabled) return { skipped: "disabled" };
  // ponytail: one account per tick. The DB lease still fences other processes. Fan out only if one tick cannot cover the lead window.
  if (ticking) return { skipped: "coalesced" };
  ticking = true;
  try {
    const db = await getAdapter();
    observeExpiredAntigravityLeases(db);
    const connections = await listConnections();
    const selected = selectDueAntigravityConnection(connections, now, random);
    if (!selected) return { ran: 0 };
    await refresh(selected, true);
    return { ran: 1, connectionId: selected.id };
  } catch {
    return { skipped: publicCategory("pre_dispatch_failure") };
  } finally {
    ticking = false;
  }
}
