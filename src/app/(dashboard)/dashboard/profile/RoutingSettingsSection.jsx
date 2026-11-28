"use client";

import { requestSettings } from "@/store/settingsStore";

import { useState, useEffect, useRef } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import { isUndefined } from "../../../../shared/utils/typeChecks.js";
import { MODEL_AUTO_SYNC_INTERVALS } from "./profileHelpers.js";

/** Routing tab: account and combo strategies, Vision Bridge, and model auto-update. */
export default function RoutingSettingsSection({ activeTab, settings, setSettings, loading }) {
  const [routingSave, setRoutingSave] = useState({ pending: false, failedPatch: null });
  const [routingDrafts, setRoutingDrafts] = useState({});
  const routingRequest = useRef({ mounted: false, pending: false });
  useEffect(() => {
    const request = routingRequest.current;
    request.mounted = true;
    return () => { request.mounted = false; };
  }, []);

  /**
   * Keep the accepted routing snapshot until PATCH succeeds. Show pending and
   * accessible failure feedback, retain rejected numeric drafts, and retry the
   * same patch. Completions after unmount do not update the page.
   */
  const saveRoutingPreference = async (patch) => {
    const request = routingRequest.current;
    if (request.pending) return;
    request.pending = true;
    setRoutingSave({ pending: true, failedPatch: null });
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!res.ok) throw new Error("Routing preference was not saved.");
      if (!request.mounted) return;
      setSettings((prev) => ({ ...prev, ...patch }));
      setRoutingDrafts((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(patch)) delete next[key];
        return next;
      });
      setRoutingSave({ pending: false, failedPatch: null });
    } catch {
      if (request.mounted) setRoutingSave({ pending: false, failedPatch: patch });
    } finally {
      request.pending = false;
    }
  };

  const updateFallbackStrategy = (strategy) => saveRoutingPreference({ fallbackStrategy: strategy });
  const updateComboStrategy = (strategy) => saveRoutingPreference({ comboStrategy: strategy });

  const updateVisionBridge = async (patch) => {
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...patch }));
      }
    } catch (err) {
      console.error("Failed to update Vision Bridge settings:", err);
    }
  };

  const handleVisionBridgeToggle = async () => {
    const enabling = !(settings.visionBridgeEnabled === true);
    const target = (settings.visionBridgeModel || "").trim();
    // Guard against a silent no-op: enabling with an empty target never reroutes
    // (the helper passes through when visionBridgeModel is empty/invalid). Clear
    // any in-flight draft into the committed value first so a typed-but-not-
    // blurred target still enables.
    const input = !isUndefined(globalThis.document) ?
    document.getElementById("vision-bridge-model-input") :
    null;
    const draft = (input?.value || "").trim();
    if (enabling && !target && !draft) return;
    const patch = draft && draft !== target ?
    { visionBridgeModel: draft, visionBridgeEnabled: enabling } :
    { visionBridgeEnabled: enabling };
    await updateVisionBridge(patch);
  };

  const updateStickyLimit = (limit) => {
    setRoutingDrafts((prev) => ({ ...prev, stickyRoundRobinLimit: limit }));
    setRoutingSave({ pending: false, failedPatch: null });
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;
    return saveRoutingPreference({ stickyRoundRobinLimit: numLimit });
  };

  const updateComboStickyLimit = (limit) => {
    setRoutingDrafts((prev) => ({ ...prev, comboStickyRoundRobinLimit: limit }));
    setRoutingSave({ pending: false, failedPatch: null });
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;
    return saveRoutingPreference({ comboStickyRoundRobinLimit: numLimit });
  };

  const updateModelAutoSyncInterval = async (value) => {
    const hours = Number(value);
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelAutoSyncIntervalHours: hours }),
      });
      if (res.ok) setSettings((prev) => ({ ...prev, modelAutoSyncIntervalHours: hours }));
    } catch (err) {
      console.error("Failed to update modelAutoSyncIntervalHours:", err);
    }
  };

  return (
      <section role="tabpanel" aria-label="Routing settings" hidden={activeTab !== "routing"} className="flex flex-col gap-5">

      <Card padding={false}><CardHeader icon="route" title="Routing Strategy" subtitle="Defaults used when DurinDoor selects an upstream model" /><CardContent className="flex flex-col gap-5"><Toggle label="Round Robin" description="Cycle through accounts to distribute load." checked={settings.fallbackStrategy === "round-robin"} onChange={() => updateFallbackStrategy(settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin")} disabled={loading || routingSave.pending} />{settings.fallbackStrategy === "round-robin" ? <Input label="Sticky Limit" hint="Calls per account before switching." type="number" min="1" max="10" value={routingDrafts.stickyRoundRobinLimit ?? (settings.stickyRoundRobinLimit || 3)} onChange={(e) => updateStickyLimit(e.target.value)} disabled={loading || routingSave.pending} /> : null}<Toggle label="Earliest Reset" description="Use the account with the soonest known quota reset." checked={settings.fallbackStrategy === "earliest-reset"} onChange={() => updateFallbackStrategy(settings.fallbackStrategy === "earliest-reset" ? "fill-first" : "earliest-reset")} disabled={loading || routingSave.pending} /><Toggle label="Cache Affinity" description="Pin each conversation to one account so the provider prompt cache keeps hitting." checked={settings.fallbackStrategy === "cache-affinity"} onChange={() => updateFallbackStrategy(settings.fallbackStrategy === "cache-affinity" ? "fill-first" : "cache-affinity")} disabled={loading || routingSave.pending} /><Toggle label="Combo Round Robin" description="Cycle through providers in combos instead of always starting with first." checked={settings.comboStrategy === "round-robin"} onChange={() => updateComboStrategy(settings.comboStrategy === "round-robin" ? "fallback" : "round-robin")} disabled={loading || routingSave.pending} />{settings.comboStrategy === "round-robin" ? <Input label="Combo Sticky Limit" hint="Calls per combo model before switching." type="number" min="1" max="100" value={routingDrafts.comboStickyRoundRobinLimit ?? (settings.comboStickyRoundRobinLimit || 1)} onChange={(e) => updateComboStickyLimit(e.target.value)} disabled={loading || routingSave.pending} /> : null}{routingSave.pending ? <p role="status" className="text-xs text-dd-muted">Saving routing preference…</p> : null}{routingSave.failedPatch ? <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-xs text-dd-danger">Could not confirm the routing save. Retry to apply this preference.</p><Button variant="secondary" size="sm" onClick={() => saveRoutingPreference(routingSave.failedPatch)}>Retry routing save</Button></div> : null}<Input id="vision-bridge-model-input" label="Vision Model" hint="Target as provider/model. Empty or invalid keeps original model." placeholder="openai/gpt-4o" key={settings.visionBridgeModel || ""} defaultValue={settings.visionBridgeModel || ""} onBlur={(e) => updateVisionBridge({ visionBridgeModel: e.target.value.trim() })} disabled={loading} /><Toggle label="Vision Bridge" description="Reroute image-bearing requests on a text-only model to this vision model." checked={settings.visionBridgeEnabled === true} onChange={handleVisionBridgeToggle} disabled={loading} /><p className="border-t border-dd-border-subtle pt-4 text-xs text-dd-muted">{settings.fallbackStrategy === "round-robin" ? `Currently distributing requests with ${settings.stickyRoundRobinLimit || 3} calls per account.` : settings.fallbackStrategy === "earliest-reset" ? "Currently prioritizing accounts whose quota resets soonest." : settings.fallbackStrategy === "cache-affinity" ? "Currently pinning each conversation to one account (Cache Affinity); requests without a conversation id use priority order." : "Currently using accounts in priority order (Fill First)."}{settings.comboStrategy === "round-robin" ? ` Combos rotate after ${settings.comboStickyRoundRobinLimit || 1} calls per model.` : " Combos always start with their first model."}</p></CardContent></Card>
      <Card padding={false}><CardHeader icon="sync" title="Model Auto-update" subtitle="Refresh provider model lists from their APIs" /><CardContent className="flex flex-col gap-3"><Field label="Update interval" hint="Providers with Auto-update models on (set on each provider page) are refreshed this often. Off stops scheduled updates; Sync now still works."><Select aria-label="Model auto-update interval" options={MODEL_AUTO_SYNC_INTERVALS} value={MODEL_AUTO_SYNC_INTERVALS.some((o) => o.value === settings.modelAutoSyncIntervalHours) ? settings.modelAutoSyncIntervalHours : 24} disabled={loading} onChange={updateModelAutoSyncInterval} /></Field></CardContent></Card>
      </section>
  );
}
