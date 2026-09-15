"use client";

import { useEffect, useState } from "react";
import { getCompositeEndpointEnabled, getLocalEndpointUrl } from "../endpoint/endpointConstants";
import { isString } from "@/shared/utils/typeChecks";

/**
 * Endpoint and API-key choices for the skills copy controls.
 *
 * Secrets are deliberately absent here. `GET /api/keys` returns management
 * views whose `maskedKey` is `sk-••••••••` — the raw credential is only
 * available from `GET /api/keys/:id/reveal`, and only at the moment the user
 * asks to copy. Nothing in this hook holds a secret, so a rendered page (or a
 * React devtools inspection of its state) never carries one.
 */
export function useSkillTargets(localPort = 20128) {
  const [endpoints, setEndpoints] = useState([]);
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = getLocalEndpointUrl(localPort);
      const collected = [{ value: local, label: `Local — ${local}` }];
      try {
        const [tunnelRes, keysRes] = await Promise.all([
          fetch("/api/tunnel/status", { cache: "no-store" }).catch(() => null),
          fetch("/api/keys").catch(() => null),
        ]);

        if (tunnelRes?.ok) {
          const status = await tunnelRes.json();
          // Both transports report their URL as `tunnelUrl` under their own
          // namespace (see EndpointPageClient.loadSettings). Only offer a
          // transport that is actually enabled — the same predicate the
          // Endpoint page uses — so a copied snippet cannot point at a
          // disabled tunnel whose URL is merely left over in the status.
          for (const [entry, label] of [
            [status?.tunnel, "Tunnel"],
            [status?.tailscale, "Tailscale"],
          ]) {
            const url = entry?.tunnelUrl;
            if (!getCompositeEndpointEnabled(entry) || !isString(url) || !url) continue;
            const base = `${url.replace(/\/+$/, "")}/v1`;
            collected.push({ value: base, label: `${label} — ${base}` });
          }
        }

        if (keysRes?.ok) {
          const body = await keysRes.json();
          const rows = Array.isArray(body?.keys) ? body.keys : [];
          if (!cancelled) {
            setKeys(
              rows
                .filter((key) => key.isActive !== false)
                .map((key) => ({ id: key.id, name: key.name || key.id, maskedKey: key.maskedKey })),
            );
          }
        }
      } finally {
        if (!cancelled) {
          setEndpoints(collected);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localPort]);

  return { endpoints, keys, loading };
}

/**
 * Fetch one key's secret for an explicit copy action.
 *
 * Returns null when the reveal fails so the caller can fall back to a
 * placeholder rather than silently copying a broken snippet.
 */
export async function revealKeySecret(keyId) {
  if (!keyId) return null;
  try {
    const res = await fetch(`/api/keys/${keyId}/reveal`);
    if (!res.ok) return null;
    const body = await res.json();
    return isString(body?.key) ? body.key : null;
  } catch {
    return null;
  }
}

/** Build the instruction text an agent receives, given a resolved secret. */
export function buildSkillInstruction({ skillUrl, baseUrl, apiKey }) {
  const lines = [`Read this skill and use it: ${skillUrl}`, `Base URL: ${baseUrl}`];
  if (apiKey) lines.push(`API key: ${apiKey}`);
  return lines.join("\n");
}
