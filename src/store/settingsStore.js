"use client";

import { create } from "zustand";
import { CLIENT_STORE_TTL_MS } from "@/shared/constants/config";

let settingsRevision = 0;
let patchSequence = 0;

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
    const revision = settingsRevision;
    set({ loading: true, error: null });
    try {
      const res = signal ? await fetch("/api/settings", { signal }) : await fetch("/api/settings");
      const data = await res.json();
      if (revision !== settingsRevision) {
        onResult?.({ ok: true, status: 200, body: get().settings });
        return get().settings;
      }
      onResult?.({ ok: res.ok, status: res.status, body: data });
      if (res.ok) {
        set({ settings: data, loading: false, lastFetched: Date.now() });
        return data;
      }
      set({ error: data.error, loading: false });
    } catch (e) {
      if (revision !== settingsRevision) return get().settings;
      set({ error: "Failed to fetch settings", loading: false });
    }
    return null;
  },

  // Cache successful settings and expose server failures to callers.
  patchSettings: async (patch, { onResult } = {}) => {
    const sequence = ++patchSequence;
    set({ error: null, errorStatus: null, errorBody: null });
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const updated = await Promise.resolve().then(() => res.json()).catch(() => ({}));
      onResult?.({ ok: res.ok, status: res.status, body: updated });
      if (!res.ok) {
        if (sequence === patchSequence) set({ error: updated.error || "Failed to save settings", errorStatus: res.status, errorBody: updated });
        return null;
      }
      // A newer PATCH is in flight or finished: this snapshot is stale.
      if (sequence !== patchSequence) return get().settings;
      settingsRevision++;
      set({ settings: updated, loading: false, error: null, lastFetched: Date.now() });
      return updated;
    } catch {
      if (sequence === patchSequence) set({ error: "Failed to save settings" });
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
