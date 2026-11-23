"use client";

import { create } from "zustand";
import { CLIENT_STORE_TTL_MS } from "@/shared/constants/config";
import api from "@/shared/utils/api";

let settingsRevision = 0;
let patchSequence = 0;
let pendingRead = null;

const useSettingsStore = create((set, get) => ({
  settings: null,
  loading: false,
  error: null,
  errorStatus: null,
  errorBody: null,
  lastFetched: 0,

  invalidate: () => { settingsRevision++; set({ lastFetched: 0 }); },

  // Skips network when cache is fresh; pass {force:true} to override
  fetchSettings: async ({ force = false, signal, onResult } = {}) => {
    const { lastFetched, settings } = get();
    if (!force && settings && Date.now() - lastFetched < CLIENT_STORE_TTL_MS) {
      onResult?.({ ok: true, status: 200, body: settings });
      return settings;
    }
    // Share only reads from the same revision; invalidation or a PATCH starts a new read.
    if (!pendingRead || pendingRead.revision !== settingsRevision) {
      const revision = settingsRevision;
      set({ loading: true, error: null });
      const promise = (async () => {
        try {
          const data = await api.get("/api/settings", signal ? { signal } : {});
          if (revision !== settingsRevision) return { ok: true, status: 200, body: get().settings };
          set({ settings: data, loading: false, lastFetched: Date.now() });
          return { ok: true, status: 200, body: data };
        } catch (e) {
          if (revision !== settingsRevision) return { ok: true, status: 200, body: get().settings };
          set({ error: e.body?.error || "Failed to fetch settings", loading: false });
          if (e.status) return { ok: false, status: e.status, body: e.body };
          return null;
        }
      })();
      pendingRead = { revision, promise };
      promise.finally(() => { if (pendingRead?.promise === promise) pendingRead = null; });
    }
    const result = await pendingRead.promise;
    if (result) onResult?.(result);
    return result?.ok ? result.body : null;
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
      settingsRevision++;
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
    await useSettingsStore.getState().fetchSettings({ force: true, signal: options.signal, onResult });
  }
  if (!result) throw new Error(useSettingsStore.getState().error || "Settings request failed");
  return { ok: result.ok, status: result.status, json: async () => result.body };
}

export default useSettingsStore;
