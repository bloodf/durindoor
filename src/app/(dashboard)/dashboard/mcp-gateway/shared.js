"use client";

/**
 * Pieces shared by the two MCP Gateway pages.
 *
 * Instances and keys are separate pages, but they are not independent: a key's
 * grants name instances, so the keys page needs the instance list even though
 * it never renders it as a section. Each page therefore fetches only what it
 * renders plus what its dialogs require, rather than both pages loading
 * everything the way the combined page did.
 */

import { useCallback, useEffect, useState } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { isString } from "@/shared/utils/typeChecks.js";

export function nowMs() {
  return Date.now();
}

export function emptyInstance() {
  return { slug: "", title: "", kind: "http", transport: "http", url: "", command: "", args: "[]", env: "{}", headers: "{}", oauth: false, enabled: true };
}

export function parseMaybeJson(value, fallback) {
  if (!value || !isString(value)) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function stringifyMaybe(value) {
  if (value == null) return "";
  if (isString(value)) return value;
  try { return JSON.stringify(value); } catch { return ""; }
}

/**
 * Load one gateway collection.
 *
 * `notify` surfaces a failed load, and the collection is emptied rather than
 * left stale: showing instances that a failed refresh can no longer vouch for
 * is how someone grants a key to something that was deleted.
 *
 * `eager: false` defers the first load until the caller invokes `reload`. The
 * keys page uses this for instances: that list backs the grants picker only,
 * so fetching it on mount makes an unrelated failure raise an error toast on a
 * page whose own list loaded fine, and revoking a key is exactly when an
 * operator cannot afford a distracting error about something else.
 */
export function useGatewayCollection(path, field, { eager = true } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(eager);
  // An empty list because the load failed is a different fact from an empty
  // list because there is nothing. Callers that render an empty state need to
  // tell them apart, or they assert "none exist" on the strength of an outage.
  const [error, setError] = useState(null);
  const notify = useNotificationStore((state) => state.addNotification);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path);
      const body = res.ok ? await res.json().catch(() => ({})) : {};
      if (!res.ok) {
        const message = body.error ?? `Failed to load ${field} (${res.status})`;
        notify({ type: "error", message });
        setError(message);
        setItems([]);
        return;
      }
      setItems(Array.isArray(body[field]) ? body[field] : []);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : `Failed to load ${field}`;
      notify({ type: "error", message });
      setError(message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [path, field, notify]);

  useEffect(() => {
    if (eager) Promise.resolve().then(reload);
  }, [eager, reload]);

  return { items, loading, error, reload, notify };
}
