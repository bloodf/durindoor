import { randomBytes } from "node:crypto";
import { loadState, saveState, generateShortId } from "../shared/state.js";
import { spawnQuickTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler } from "./cloudflared.js";
import { clearPid } from "./pid.js";
import { waitForHealth, probeUrlAlive } from "./healthCheck.js";
import { WORKER_URL } from "./config.js";
import { workerFetch } from "./workerFetch.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { getAppPort } from "@/shared/constants/config";

const svc = {
  cancelToken: { cancelled: false },
  spawnInProgress: false,
  lastRestartAt: 0,
  activeLocalPort: null,
};

export function getTunnelService() { return svc; }
export function isTunnelManuallyDisabled() { return svc.cancelToken.cancelled; }
export function isTunnelReconnecting() { return svc.spawnInProgress; }

let onUnexpectedExit = null;
export function setTunnelUnexpectedExitCallback(cb) { onUnexpectedExit = cb; }

function stableUrl(shortId) {
  if (!WORKER_URL || !shortId) return "";
  const relay = new URL(WORKER_URL);
  return `${relay.protocol}//r${shortId}.${relay.host}`;
}

async function registerTunnelUrl(shortId, tunnelUrl, ownershipSecret) {
  if (!WORKER_URL) return;
  await workerFetch(`${WORKER_URL.replace(/\/$/, "")}/api/tunnel/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortId, tunnelUrl, ownershipSecret })
  });
}

function throwIfCancelled(token) {
  if (token.cancelled) throw new Error("tunnel cancelled");
}

export async function enableTunnel(localPort = getAppPort()) {
  console.log(`[Tunnel] enable start (port=${localPort})`);
  svc.cancelToken = { cancelled: false };
  svc.activeLocalPort = localPort;
  svc.spawnInProgress = true;
  const token = svc.cancelToken;

  try {
    if (isCloudflaredRunning()) {
      const existing = loadState();
      if (existing?.tunnelUrl && existing?.shortId) {
        const publicUrl = stableUrl(existing.shortId);
        // Reuse only if BOTH direct + public URL alive (avoid stale socket after network change)
        const [directOk, publicOk] = await Promise.all([
          probeUrlAlive(existing.tunnelUrl),
          publicUrl ? probeUrlAlive(publicUrl) : Promise.resolve(true),
        ]);
        if (directOk && publicOk) {
          console.log(`[Tunnel] already running, reuse: ${existing.tunnelUrl}`);
          return { success: true, tunnelUrl: existing.tunnelUrl, shortId: existing.shortId, publicUrl, alreadyRunning: true };
        }
        console.log(`[Tunnel] stale (direct=${directOk} public=${publicOk}), respawn`);
      }
    }

    killCloudflared(localPort);
    console.log("[Tunnel] killed existing cloudflared");
    throwIfCancelled(token);

    const existing = loadState();
    const shortId = existing?.shortId || generateShortId();
    // Persist ownership before registering so a restart can reclaim this ID.
    const ownershipSecret = existing?.ownershipSecret || randomBytes(32).toString("hex");
    saveState({ shortId, ownershipSecret });

    const onUrlUpdate = async (url) => {
      if (token.cancelled) return;
      console.log(`[Tunnel] url updated: ${url}`);
      await registerTunnelUrl(shortId, url, ownershipSecret);
      saveState({ shortId, tunnelUrl: url });
      await updateSettings({ tunnelEnabled: true, tunnelUrl: url });
    };

    // Register exit handler BEFORE spawn so it fires even on early exit
    setUnexpectedExitHandler(() => {
      console.warn("[Tunnel] cloudflared exited unexpectedly, scheduling respawn");
      if (onUnexpectedExit) onUnexpectedExit();
    });

    const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate);
    console.log(`[Tunnel] spawned: ${tunnelUrl}`);
    throwIfCancelled(token);

    const publicUrl = stableUrl(shortId);
    await registerTunnelUrl(shortId, tunnelUrl, ownershipSecret);
    saveState({ shortId, tunnelUrl });
    await updateSettings({ tunnelEnabled: true, tunnelUrl });
    if (publicUrl) console.log(`[Tunnel] registered shortId=${shortId} publicUrl=${publicUrl}`);

    // Either registered health endpoint proves this tunnel is serving;
    // keep the relay first because its stable public URL remains the preferred path.
    const healthyUrl = await waitForHealth([publicUrl, tunnelUrl].filter(Boolean), token);
    if (healthyUrl === publicUrl) {
      console.log("[Tunnel] public URL healthy");
      // Direct tunnel probe is best-effort: DNS for *.trycloudflare.com can be slow/blocked
      if (!(await probeUrlAlive(tunnelUrl))) {
        console.warn("[Tunnel] direct URL not reachable yet, continuing via publicUrl");
      } else {
        console.log("[Tunnel] direct URL healthy");
      }
    } else if (publicUrl) {
      console.warn(`[Tunnel] relay not answering yet, continuing via direct URL: ${healthyUrl}`);
    }

    console.log("[Tunnel] enable success");
    return { success: true, tunnelUrl, shortId, publicUrl };
  } catch (e) {
    // Suppress noise when spawn was deliberately killed (restart/disable superseded it)
    if (!/cloudflared killed|tunnel cancelled/.test(e.message)) {
      console.error(`[Tunnel] enable error: ${e.message}`);
    }
    throw e;
  } finally {
    svc.spawnInProgress = false;
  }
}

export async function disableTunnel() {
  console.log("[Tunnel] disable");
  // Abort any in-flight enable so it cannot resurrect state after we clear it
  svc.cancelToken.cancelled = true;
  setUnexpectedExitHandler(null);

  try { killCloudflared(svc.activeLocalPort); } catch (e) { console.warn(`[Tunnel] kill warn: ${e.message}`); }
  clearPid();

  const state = loadState();
  if (state) saveState({ shortId: state.shortId, tunnelUrl: null });

  await updateSettings({ tunnelEnabled: false, tunnelUrl: "" });
  // Force-clear flags so a subsequent enable is not blocked by a stuck spawnInProgress
  svc.spawnInProgress = false;
  svc.activeLocalPort = null;
  return { success: true };
}

export async function getTunnelStatus() {
  const settings = await getSettings();
  const settingsEnabled = settings.tunnelEnabled === true;
  const state = loadState();
  const shortId = state?.shortId || "";
  const publicUrl = stableUrl(shortId);
  const tunnelUrl = state?.tunnelUrl || "";

  // Lazy: skip PID probe entirely when user disabled tunnel
  const running = settingsEnabled ? isCloudflaredRunning() : false;

  // Detect an externally managed cloudflared that the app does not own.
  // isCloudflaredRunning only sees the app's spawnQuickTunnel PID file;
  // any system-installed named tunnel (e.g. /etc/cloudflared/*.yml) is
  // invisible to the app but still a working endpoint. If the operator
  // persisted an external URL in settings and the app has no PID, surface
  // that as an "external" state instead of an "Enable" CTA.
  const externalTunnel =
    !running && settings.tunnelUrl && !state?.tunnelUrl
      ? { running: true, tunnelUrl: settings.tunnelUrl }
      : null;

  // Every distinct, non-empty URL this tunnel is reachable at, so the UI can
  // show ALL configured endpoints (stable worker shortlink + the ephemeral /
  // custom quick-tunnel URL) instead of guessing a single "the" URL. Ordered
  // most-stable first; de-duplicated.
  const allUrls = [...new Set([
    publicUrl,
    settings.tunnelUrl || "",
    tunnelUrl,
    externalTunnel?.tunnelUrl || "",
  ].filter(Boolean))];

  return {
    enabled: settingsEnabled && running,
    settingsEnabled,
    tunnelUrl,
    shortId,
    publicUrl,
    running,
    externalTunnel,
    allUrls,
  };
}
