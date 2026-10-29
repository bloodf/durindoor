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

import { useCallback, useEffect, useState, useRef } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { requestCollection } from "../providers/workflowRequests.js";
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
 * Failed refreshes retain the last confirmed records with an explicit error.
 * Consumers must block grant edits while that dependency is unavailable.
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

  const generation = useRef(0);
  const reload = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const loaded = await requestCollection(path, field);
      if (token === generation.current) setItems(loaded);
    } catch (caught) {
      if (token !== generation.current) return;
      const message = caught instanceof Error ? caught.message : `Failed to load ${field}`;
      notify({ type: "error", message }); setError(message);
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [path, field, notify]);

  useEffect(() => {
    if (eager) Promise.resolve().then(reload);
  }, [eager, reload]);

  return { items, loading, error, reload, notify };
}
