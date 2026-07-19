import { isPubliclyFetchableBase } from "./oauthCimd.js";

function oauthCapableOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isPubliclyFetchableBase(url.origin)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/** Selects a configured, active public OAuth origin before request fallbacks. */
export function selectOAuthPublicBase({ envOverride, tailscale, tunnel }) {
  if (envOverride) {
    try { return new URL(envOverride).origin; } catch { /* fall through */ }
  }
  return oauthCapableOrigin(tailscale?.enabled ? tailscale.tunnelUrl : null)
    || oauthCapableOrigin(tunnel?.enabled ? (tunnel.publicUrl || tunnel.tunnelUrl) : null);
}
