"use client";

import { useCallback, useState } from "react";
import { isBrowser } from "@/shared/utils/typeChecks.js";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import ProviderLimits from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits";
import MonitoringWidget from "./MonitoringWidget.jsx";
import { USAGE_PERIOD_OPTIONS } from "@/lib/usagePeriods.js";
import ComboUsageReport from "@/app/(dashboard)/dashboard/combos/components/ComboUsageReport.jsx";
import ReviewApiKeyLimitsCard from "../usage/ReviewApiKeyLimitsCard.jsx";
import ReviewUsageStats from "../usage/ReviewUsageStats.jsx";
import MotionIcon from "../motion/MotionIcon.jsx";
import DashboardCanvas from "./DashboardCanvas.jsx";
import SaverWidgets from "./SaverWidgets.jsx";
import PxpipeWidgets from "./PxpipeWidgets.jsx";
import { WORKSPACES_KEY, WORKSPACE_WIDGETS, changeWorkspace, normalizeWorkspaces, readWorkspaces, dashboardSources } from "./model.js";
import "./dashboards.css";

/** Named dashboards share actual gateway widgets; only this review's browser preferences are saved. */
export default function WorkspacesPage({ initialWorkspaces, persistLayout = false }) {
  const [period, setPeriod] = useState("today");
  const [collection, setCollection] = useState(() => {
    if (initialWorkspaces) return normalizeWorkspaces(initialWorkspaces);
    try { return persistLayout && isBrowser() ? readWorkspaces(window.localStorage) : normalizeWorkspaces(null); }
    catch { return normalizeWorkspaces(null); }
  });
  const [nameForm, setNameForm] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sessions, setSessions] = useState({});
  const [notice, setNotice] = useState("");
  const current = collection.dashboards.find((dashboard) => dashboard.id === collection.activeId);
  const onSessionChange = useCallback((session) => {
    setSessions((previous) => ({ ...previous, [current.id]: session }));
  }, [current.id]);
  const session = sessions[current.id];
  const sources = dashboardSources(session?.editing ? session.draft : session?.saved || current.layout);
  const apply = (action) => {
    const next = changeWorkspace(collection, action);
    setCollection(next);
    let feedback = action.type === "select" ? "" : "Dashboard preferences saved for this review.";
    if (persistLayout) {
      try { window.localStorage.setItem(WORKSPACES_KEY, JSON.stringify(next)); }
      catch { feedback = "Preferences saved for this view. Browser storage is unavailable."; }
    }
    setNotice(feedback);
  };
  const submitName = () => {
    if (!nameForm?.name.trim()) return;
    if (nameForm.type === "create") {
      let index = collection.dashboards.length + 1;
      while (collection.dashboards.some((dashboard) => dashboard.id === `dashboard-${index}`)) index++;
      apply({ type: "create", id: `dashboard-${index}`, name: nameForm.name });
    } else apply({ type: "rename", id: current.id, name: nameForm.name });
    setNameForm(null);
  };
  return <div className="v5-dashboard-page"><header className="v5-dashboard-page-heading"><div><h1>Your dashboards</h1><p>Combine Usage, Token Saver, quota and monitoring widgets into your own workspace.</p></div><Button onClick={() => setNameForm({ type: "create", name: "" })}><MotionIcon name="add" />New dashboard</Button></header><div className="v5-workspaces-toolbar"><div className="v5-workspace-picker"><Select aria-label="Active dashboard" options={collection.dashboards.map((dashboard) => ({ value: dashboard.id, label: dashboard.name }))} value={current.id} onChange={(id) => apply({ type: "select", id })} /></div><Button variant="ghost" icon="edit" onClick={() => setNameForm({ type: "rename", name: current.name })}>Rename dashboard</Button><Button variant="ghost" icon="delete" disabled={collection.dashboards.length === 1} onClick={() => setDeleteOpen(true)}>Delete dashboard</Button><div className="v5-workspace-period-picker"><Select aria-label="Dashboard period" options={USAGE_PERIOD_OPTIONS} value={period} onChange={setPeriod} /></div></div>{notice ? <p role="status">{notice}</p> : null}<h2 className="v5-workspace-name">{current.name}</h2><ReviewUsageStats enabled={sources.usage} period={period} setPeriod={setPeriod} hidePeriodSelector renderSections={(usage) => <SaverWidgets enabled={sources.saver} period={period} setPeriod={setPeriod} hidePeriodSelector renderSections={(saver) => <PxpipeWidgets enabled={sources.pxpipe} renderSections={(pxpipe) => <DashboardCanvas key={current.id} initialSession={session} onSessionChange={onSessionChange} catalog={WORKSPACE_WIDGETS} initialLayout={current.layout} sections={{ ...usage, ...saver, ...pxpipe, combos: <ComboUsageReport period={period} />, keys: <ReviewApiKeyLimitsCard />, quota: <ProviderLimits />, monitoring: <MonitoringWidget /> }} onSave={(layout) => apply({ type: "layout", id: current.id, layout })} />} />} />} /><Modal open={Boolean(nameForm)} onClose={() => setNameForm(null)} title={nameForm?.type === "create" ? "New dashboard" : "Rename dashboard"} footer={<><Button variant="secondary" onClick={() => setNameForm(null)}>Cancel</Button><Button disabled={!nameForm?.name.trim()} onClick={submitName}>{nameForm?.type === "create" ? "Create dashboard" : "Save name"}</Button></>}><Input label="Dashboard name" maxLength={80} value={nameForm?.name || ""} placeholder="Team operations" onChange={(event) => setNameForm({ ...nameForm, name: event.target.value })} /></Modal><Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete dashboard" footer={<><Button variant="secondary" onClick={() => setDeleteOpen(false)}>Keep dashboard</Button><Button variant="danger" onClick={() => { apply({ type: "delete", id: current.id }); setDeleteOpen(false); }}>Delete dashboard</Button></>}><p>Delete {current.name} and its layout preferences? Gateway usage and compression data will remain available.</p></Modal></div>;
}
