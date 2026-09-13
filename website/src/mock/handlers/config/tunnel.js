// /api/tunnel/* — Cloudflare quick tunnel and Tailscale Funnel. Tunnel state
// lives in the settings collection like the real app (tunnelEnabled,
// tunnelUrl, tailscaleEnabled, tailscaleUrl).
import { sse, wait } from "../../http.js";
import { readSettings, writeSettings } from "./settings.js";

const TUNNEL_URL = "https://balin-erebor.trycloudflare.com";
const SHORT_ID = "k7m2qx";
const PUBLIC_URL = `https://r${SHORT_ID}.abc-tunnel.us`;
const TAILSCALE_URL = "https://erebor-forge.tail4b2c1.ts.net";
const TUNNEL_HOSTS = [/\.trycloudflare\.com$/, /\.abc-tunnel\.us$/, /\.ts\.net$/];

function tunnelStatus(settings) {
  const enabled = settings.tunnelEnabled === true;
  return {
    enabled,
    settingsEnabled: enabled,
    tunnelUrl: enabled ? settings.tunnelUrl || TUNNEL_URL : "",
    shortId: SHORT_ID,
    publicUrl: enabled ? PUBLIC_URL : "",
    running: enabled,
    externalTunnel: null,
    allUrls: enabled ? [PUBLIC_URL, settings.tunnelUrl || TUNNEL_URL] : [],
  };
}

function tailscaleStatus(settings) {
  const enabled = settings.tailscaleEnabled === true;
  return {
    enabled,
    settingsEnabled: enabled,
    tunnelUrl: enabled ? settings.tailscaleUrl || TAILSCALE_URL : "",
    loggedIn: true,
    running: enabled,
    systemTailscale: null,
  };
}

export default function register(router, { store, external }) {
  router.get("/api/tunnel/status", () => {
    const settings = readSettings(store);
    return { tunnel: tunnelStatus(settings), tailscale: tailscaleStatus(settings), download: { downloading: false, progress: 0 } };
  });

  router.post("/api/tunnel/enable", async () => {
    await wait(1800);
    writeSettings(store, { tunnelEnabled: true, tunnelUrl: TUNNEL_URL });
    return { success: true, tunnelUrl: TUNNEL_URL, shortId: SHORT_ID, publicUrl: PUBLIC_URL };
  });

  router.post("/api/tunnel/disable", async () => {
    await wait(400);
    writeSettings(store, { tunnelEnabled: false, tunnelUrl: "" });
    return { success: true };
  });

  router.get("/api/tunnel/tailscale-check", () => ({
    installed: true,
    loggedIn: true,
    platform: "darwin",
    brewAvailable: true,
    daemonRunning: true,
    customDaemonRunning: true,
    systemDaemonRunning: false,
    hasCachedPassword: true,
  }));

  router.post("/api/tunnel/tailscale-enable", async () => {
    await wait(1200);
    writeSettings(store, { tailscaleEnabled: true, tailscaleUrl: TAILSCALE_URL });
    return { success: true, tunnelUrl: TAILSCALE_URL };
  });

  router.post("/api/tunnel/tailscale-disable", async () => {
    await wait(400);
    writeSettings(store, { tailscaleEnabled: false, tailscaleUrl: "" });
    return { success: true };
  });

  router.post("/api/tunnel/tailscale-install", () => sse({
    events: [
      { event: "progress", data: { message: "Checking Homebrew..." } },
      { event: "progress", data: { message: "brew install tailscale" } },
      { event: "progress", data: { message: "Starting tailscaled on /tmp/tailscaled.sock" } },
      { event: "progress", data: { message: "Tailscale 1.94.2 installed" } },
      { event: "done", data: { success: true, authUrl: null } },
    ],
  }));

  // The endpoint page pings `${tunnelUrl}/api/health` after enabling.
  external(
    (url) => TUNNEL_HOSTS.some((pattern) => pattern.test(url.hostname)) && url.pathname === "/api/health",
    () => ({ status: "ok" }),
  );
}
