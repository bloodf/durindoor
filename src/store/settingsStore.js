"use client";

import { create } from "zustand";
import { CLIENT_STORE_TTL_MS } from "@/shared/constants/config";
import api from "@/shared/utils/api";
import { isRecord } from "@/shared/utils/typeChecks";

let settingsRevision = 0;
let patchSequence = 0;
let pendingRead = null;
let activeReads = 0;
let readSequence = 0;
let publishedReadSequence = 0;

function advanceSettingsRevision() {
  settingsRevision++;
  activeReads = 0;
}

// Publish only to the active revision, in request order when reads overlap.
async function readSettings(set, get, { revision, signal, cache, headers }) {
  const sequence = ++readSequence;
  const canPublish = () => revision === settingsRevision && sequence > publishedReadSequence;
  activeReads++;
  set({ loading: true, error: null });
  try {
    const data = await api.get("/api/settings", { signal, cache, headers });
    signal?.throwIfAborted();
    if (!isRecord(data)) {
      const error = "Invalid settings response";
      if (canPublish()) {
        publishedReadSequence = sequence;
        set({ error });
      }
      // Fetch succeeded but yielded no settings object. Let callers use their
      // HTTP failure path instead of treating the missing data as settings.
      return { ok: false, status: 502, body: { error } };
    }
    if (!canPublish()) return { ok: true, status: 200, body: get().settings ?? data };
    publishedReadSequence = sequence;
    set({ settings: data, error: null, lastFetched: Date.now() });
    return { ok: true, status: 200, body: data };
  } catch (error) {
    if (signal?.aborted) return { error: signal.reason };
    if (canPublish()) {
      publishedReadSequence = sequence;
      set({ error: error?.body?.error || "Failed to fetch settings" });
    }
    if (error?.status) return { ok: false, status: error.status, body: error.body || {} };
    return { error };
  } finally {
    if (revision === settingsRevision && --activeReads === 0) set({ loading: false });
  }
}

const useSettingsStore = create((set, get) => ({
  settings: null,
  loading: false,
  error: null,
  errorStatus: null,
  errorBody: null,
  lastFetched: 0,

  invalidate: () => { advanceSettingsRevision(); set({ loading: false, lastFetched: 0 }); },

  /** Forced or cancelable reads run independently of shared cache refreshes. */
  fetchSettings: async ({ force = false, signal, cache, headers, onResult } = {}) => {
    const { lastFetched, settings } = get();
    if (signal?.aborted) {
      onResult?.({ error: signal.reason });
      return null;
    }
    const shareable = !force && !signal && !cache && !headers;
    if (shareable && settings && Date.now() - lastFetched < CLIENT_STORE_TTL_MS) {
      onResult?.({ ok: true, status: 200, body: settings });
      return settings;
    }
    const revision = settingsRevision;
    let promise = shareable && pendingRead?.revision === revision ? pendingRead.promise : null;
    if (!promise) {
      promise = readSettings(set, get, { revision, signal, cache: cache ?? (force ? "no-store" : undefined), headers });
      if (shareable) pendingRead = { revision, promise };
    }
    const result = await promise;
    if (pendingRead?.promise === promise) pendingRead = null;
    onResult?.(result);
    return result.ok ? result.body : null;
  },

  // Cache successful settings and expose server failures to callers.
  patchSettings: async (patch, { onResult } = {}) => {
    const sequence = ++patchSequence;
    set({ error: null, errorStatus: null, errorBody: null });
    try {
      const updated = await api.patch("/api/settings", patch);
      onResult?.({ ok: true, status: 200, body: updated });
      // A newer PATCH is in flight or finished: this snapshot is stale.
      if (sequence !== patchSequence) return get().settings;
      advanceSettingsRevision();
      set({ settings: updated, loading: false, error: null, lastFetched: Date.now() });
      return updated;
    } catch (e) {
      if (e.status) onResult?.({ ok: false, status: e.status, body: e.body || {} });
      if (sequence === patchSequence) set({ error: e.body?.error || "Failed to save settings", errorStatus: e.status || null, errorBody: e.body || null });
      return null;
    }
  },
}));

// Response-shaped bridge for callers that already distinguish HTTP failures.
// All reads and writes still pass through the shared cache and revision guard.
export async function requestSettings(options = {}) {
  let result;
  const onResult = (value) => { result = value; };
  if (options.method === "PATCH") {
    await useSettingsStore.getState().patchSettings(JSON.parse(options.body), { onResult });
  } else {
    await useSettingsStore.getState().fetchSettings({
      force: true, signal: options.signal, cache: options.cache, headers: options.headers, onResult,
    });
  }
  if (result && "error" in result) throw result.error;
  if (!result) throw new Error(useSettingsStore.getState().error || "Settings request failed");
  return { ok: result.ok, status: result.status, json: async () => result.body };
}

export default useSettingsStore;
