"use client";

import { create } from "zustand";
import { CLIENT_STORE_TTL_MS } from "@/shared/constants/config";

let settingsRevision = 0;
let patchSequence = 0;

const useSettingsStore = create((set, get) => ({
  settings: null,
  loading: false,
  error: null,
  lastFetched: 0,

  invalidate: () => set({ lastFetched: 0 }),

  // Skips network when cache is fresh; pass {force:true} to override
  fetchSettings: async ({ force = false } = {}) => {
    const { lastFetched, settings } = get();
    if (!force && settings && Date.now() - lastFetched < CLIENT_STORE_TTL_MS) return settings;
    const revision = settingsRevision;
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (revision !== settingsRevision) return get().settings;
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

  // PATCH server + merge into local cache (no extra fetch needed)
  patchSettings: async (patch) => {
    const sequence = ++patchSequence;
    set({ error: null });
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        let message = "Failed to save settings";
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {}
        if (sequence === patchSequence) set({ error: message });
        return null;
      }
      const updated = await res.json();
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

export default useSettingsStore;
