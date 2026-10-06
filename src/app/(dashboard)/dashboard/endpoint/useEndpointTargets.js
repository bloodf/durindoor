"use client";

import { useEffect, useState } from "react";
import { getCompositeEndpointEnabled, getLocalEndpointUrl } from "./endpointConstants";
import { isString } from "@/shared/utils/typeChecks";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function toBase(url) {
  if (!isString(url)) return "";
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed ? `${trimmed}/v1` : "";
}

/**
 * Derive every reachable endpoint row from a `/api/tunnel/status` payload,
 * mirroring the rows EndpointPageClient renders. Pure so it is testable
 * without a DOM. `location` is `{ origin, hostname }` or null (SSR).
 */
export function buildEndpointTargets(status, { localPort = 20128, location = null } = {}) {
  const targets = [];
  const seen = new Set();
  const add = (id, prefix, value) => {
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ id, label: `${prefix} — ${value}`, value });
  };

  add("local", "Local", getLocalEndpointUrl(localPort));

  const tunnel = status?.tunnel;
  if (getCompositeEndpointEnabled(tunnel)) add("tunnel", "Tunnel", toBase(tunnel?.tunnelUrl));
  if (Array.isArray(tunnel?.allUrls)) {
    for (const url of tunnel.allUrls) add(`tunnel-all:${url}`, "Tunnel", toBase(url));
  }
  add("tunnel-external", "Tunnel", toBase(tunnel?.externalTunnel?.tunnelUrl));

  const tailscale = status?.tailscale;
  if (getCompositeEndpointEnabled(tailscale)) add("tailscale", "Tailscale", toBase(tailscale?.tunnelUrl));
  add("tailscale-external", "External Tailscale", toBase(tailscale?.systemTailscale?.tunnelUrl));

  if (
    isString(location?.origin) && /^https?:\/\//i.test(location.origin)
    && isString(location.hostname) && location.hostname
    && !LOCAL_HOSTNAMES.has(location.hostname.toLowerCase())
  ) {
    add("browser-origin", "This host", toBase(location.origin));
  }

  return targets;
}

/**
 * Endpoint choices (local, tunnels, Tailscale, and the host the dashboard is
 * opened from) shared by pages that hand out a base URL.
 */
export function useEndpointTargets(localPort = 20128) {
  const [endpoints, setEndpoints] = useState(() => buildEndpointTargets(null, { localPort }));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let status = null;
      try {
        const res = await fetch("/api/tunnel/status", { cache: "no-store" });
        if (res?.ok) status = await res.json();
      } catch {
        // Status is optional: fall back to the local (and browser-origin) rows.
      }
      if (cancelled) return;
      const location = typeof window === "undefined" ? null : window.location;
      setEndpoints(buildEndpointTargets(status, { localPort, location }));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [localPort]);

  return { endpoints, loading };
}
