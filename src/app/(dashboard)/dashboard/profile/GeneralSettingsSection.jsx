"use client";

import { requestSettings } from "@/store/settingsStore";

import { useState, useEffect } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import useSettingsStore from "@/store/settingsStore";

/** General tab: appearance, update notifications, language, and model catalog exposure. */
export default function GeneralSettingsSection({ activeTab, settings, setSettings, loading, theme, setTheme, locale, setLangOpen }) {
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationError, setNotificationError] = useState("");

  const updateHidePaidModels = async (hidePaidModels) => {
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidePaidModels })
      });
      if (res.ok) {
        const data = await res.json();
        setSettings((prev) => ({ ...prev, hidePaidModels: data.hidePaidModels === true }));
      }
    } catch (err) {
      console.error("Failed to update hide paid models:", err);
    }
  };

  const updateExposeComboOnly = async (exposeComboOnly) => {
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exposeComboOnly })
      });
      if (res.ok) {
        const data = await res.json();
        setSettings((prev) => ({ ...prev, exposeComboOnly: data.exposeComboOnly === true }));
      }
    } catch (err) {
      console.error("Failed to update combo-only model exposure:", err);
    }
  };

  // OmniRoute #11481 (port(omniroute)): operator glob allow/deny list for
  // /v1/models exposure (mirrored into auto/* combo pools server-side, see
  // src/shared/utils/modelExposureList.js). One entry per line; entries may
  // be an exact "provider/model" or "model" id, or a glob using * / ?.
  const [modelVisibilityDraft, setModelVisibilityDraft] = useState({ allow: "", deny: "" });
  const [modelVisibilitySaving, setModelVisibilitySaving] = useState(false);
  useEffect(() => {
    setModelVisibilityDraft({
      allow: (Array.isArray(settings.modelVisibilityAllowlist) ? settings.modelVisibilityAllowlist : []).join("\n"),
      deny: (Array.isArray(settings.modelVisibilityDenylist) ? settings.modelVisibilityDenylist : []).join("\n")
    });
  }, [settings.modelVisibilityAllowlist, settings.modelVisibilityDenylist]);

  const saveModelVisibilityLists = async () => {
    const toList = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);
    const modelVisibilityAllowlist = toList(modelVisibilityDraft.allow);
    const modelVisibilityDenylist = toList(modelVisibilityDraft.deny);
    setModelVisibilitySaving(true);
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelVisibilityAllowlist, modelVisibilityDenylist })
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, modelVisibilityAllowlist, modelVisibilityDenylist }));
      }
    } catch (err) {
      console.error("Failed to update model visibility lists:", err);
    } finally {
      setModelVisibilitySaving(false);
    }
  };

  const updateNotificationPreference = async (enabled) => {
    setNotificationSaving(true);
    setNotificationError("");
    const updated = await useSettingsStore.getState().patchSettings({ showUpdateNotifications: enabled });
    if (updated) setSettings((prev) => ({ ...prev, showUpdateNotifications: enabled }));
    else setNotificationError("Failed to save update notification preference. Please try again.");
    setNotificationSaving(false);
  };

  return (
      <section role="tabpanel" aria-label="General settings" hidden={activeTab !== "general"} className="flex flex-col gap-5">

      <Card padding={false}><CardHeader icon="palette" title="Appearance" subtitle="Dashboard display preferences" /><CardContent><Field group label="Theme" hint="Choose how DurinDoor looks on this device."><SegmentedControl aria-label="Theme" options={[{value:"light",label:"Light"},{value:"dark",label:"Dark"},{value:"system",label:"System"}]} value={theme} onChange={setTheme} /></Field></CardContent></Card>

      <Card padding={false}><CardHeader icon="notifications" title="Update notifications" subtitle="Dashboard update preferences" /><CardContent><Toggle label="Show update notifications" description="Check for new versions and show update prompts in the sidebar." checked={settings.showUpdateNotifications !== false} disabled={loading || notificationSaving} onChange={updateNotificationPreference} />{notificationError ? <p role="alert" className="mt-2 text-xs text-dd-danger">{notificationError}</p> : null}</CardContent></Card>

      <Card padding={false}><CardHeader icon="language" title="Language" subtitle="Regional display preferences" /><CardContent><button type="button" onClick={() => setLangOpen(true)} data-i18n-skip="true" className="flex min-h-11 w-full items-center justify-between rounded-dd border border-dd-border bg-dd-surface-2 px-3 text-left text-[13px] text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"><span>Display language</span><span role="img" aria-label={locale} className="text-xl">{LOCALE_FLAGS[locale] || "🌐"}</span></button></CardContent></Card>

      <Card padding={false}><CardHeader icon="view_list" title="Model catalog" subtitle="Control model discovery and selectors" /><CardContent className="divide-y divide-dd-border-subtle"><div className="pb-4"><Toggle label="Expose combos only" description="When ON, /v1/models lists only configured combo names." checked={settings.exposeComboOnly === true} disabled={loading} onChange={() => updateExposeComboOnly(!(settings.exposeComboOnly === true))} /></div><div className="py-4"><Toggle label="Hide paid models" description="When ON, /v1/models, dashboard pickers, and combo pools only show free or unpriced models." checked={settings.hidePaidModels === true} disabled={loading} onChange={() => updateHidePaidModels(!(settings.hidePaidModels === true))} /></div><div className="pt-4 space-y-3">
        <div>
          <p className="text-[13px] font-medium text-dd-text">Model exposure list</p>
          <p className="text-xs text-dd-subtle">Operator allow/deny list for /v1/models and auto/* combo pools. One entry per line: an exact id (&quot;provider/model&quot; or &quot;model&quot;) or a glob with * / ?. Deny wins over allow; an empty allowlist exposes everything not denied.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Textarea
            label="Allowlist"
            hint="Empty = no restriction"
            value={modelVisibilityDraft.allow}
            disabled={loading || modelVisibilitySaving}
            onChange={(e) => setModelVisibilityDraft((prev) => ({ ...prev, allow: e.target.value }))}
            placeholder={"openai/*\nanthropic/claude-*"}
          />
          <Textarea
            label="Denylist"
            hint="Checked before the allowlist"
            value={modelVisibilityDraft.deny}
            disabled={loading || modelVisibilitySaving}
            onChange={(e) => setModelVisibilityDraft((prev) => ({ ...prev, deny: e.target.value }))}
            placeholder={"*-preview\nsome-provider/expensive-model"}
          />
        </div>
        <Button size="sm" variant="secondary" disabled={loading || modelVisibilitySaving} onClick={saveModelVisibilityLists}>
          {modelVisibilitySaving ? "Saving…" : "Save exposure list"}
        </Button>
      </div></CardContent></Card>
      </section>
  );
}
