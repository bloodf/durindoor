"use client";

import { useEffect, useState } from "react";
import { useEndpointTargets } from "../endpoint/useEndpointTargets";
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
  const { endpoints, loading: endpointsLoading } = useEndpointTargets(localPort);
  const [keys, setKeys] = useState([]);
  const [keysLoading, setKeysLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keysRes = await fetch("/api/keys").catch(() => null);
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
        if (!cancelled) setKeysLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { endpoints, keys, loading: endpointsLoading || keysLoading };
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
