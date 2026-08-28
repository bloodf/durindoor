import { resolveDns } from "../shared/dnsResolver.js";
import { HEALTH_CHECK } from "./config.js";

export async function probeUrlAlive(url) {
  if (!url) return false;
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return false; }

  if (!await resolveDns(hostname, HEALTH_CHECK.dnsTimeoutMs)) return false;

  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK.fetchTimeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Probes one URL or ordered candidates until one responds, returning the responding URL.
 * Empty candidates fail closed rather than treating an unverified tunnel as healthy.
 *
 * @param {string|string[]} urls
 * @param {{ cancelled: boolean }} cancelToken
 * @returns {Promise<string>}
 */
export async function waitForHealth(urls, cancelToken = { cancelled: false }) {
  const candidates = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (candidates.length === 0) throw new Error("Health check requires at least one URL");

  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK.timeoutMs) {
    if (cancelToken.cancelled) throw new Error("cancelled");
    for (const url of candidates) {
      if (cancelToken.cancelled) throw new Error("cancelled");
      if (await probeUrlAlive(url)) return url;
    }
    await new Promise((r) => setTimeout(r, HEALTH_CHECK.intervalMs));
  }
  throw new Error(`Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`);
}
