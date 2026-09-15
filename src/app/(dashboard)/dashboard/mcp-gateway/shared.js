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
 */
export function useGatewayCollection(path, field) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const notify = useNotificationStore((state) => state.addNotification);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(path);
      const body = res.ok ? await res.json().catch(() => ({})) : {};
      if (!res.ok) {
        notify({ type: "error", message: body.error ?? `Failed to load ${field} (${res.status})` });
        setItems([]);
        return;
      }
      setItems(Array.isArray(body[field]) ? body[field] : []);
    } catch (error) {
      notify({ type: "error", message: error instanceof Error ? error.message : `Failed to load ${field}` });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [path, field, notify]);

  useEffect(() => {
    Promise.resolve().then(reload);
  }, [reload]);

  return { items, loading, reload, notify };
}
