"use client";

import Link from "next/link";
import { isBrowser } from "@/shared/utils/typeChecks.js";
import { useCallback, useState } from "react";
import MotionIcon from "../motion/MotionIcon.jsx";
import DashboardCanvas from "./DashboardCanvas.jsx";
import SaverWidgets from "./SaverWidgets.jsx";
import PxpipeWidgets from "./PxpipeWidgets.jsx";
import { SAVER_LAYOUT_KEY, SAVER_WIDGETS, dashboardSources, normalizeDashboardLayout, readDashboardLayout } from "./model.js";
import "./dashboards.css";

/** Review-only dashboard; compression settings remain at their existing dedicated route. */
export default function TokenSaverDashboard({ initialLayout, persistLayout = false }) {
  const [layout, setLayout] = useState(() => {
    if (initialLayout) return normalizeDashboardLayout(initialLayout, SAVER_WIDGETS);
    try { return persistLayout && isBrowser() ? readDashboardLayout(window.localStorage, SAVER_LAYOUT_KEY, SAVER_WIDGETS) : normalizeDashboardLayout(null, SAVER_WIDGETS); }
    catch { return normalizeDashboardLayout(null, SAVER_WIDGETS); }
  });
  const sources = dashboardSources(layout);
  const onSessionChange = useCallback((session) => setLayout(session.editing ? session.draft : session.saved), []);
  return <div className="v5-dashboard-page"><header className="v5-dashboard-page-heading"><div><h1>Token Saver dashboard</h1><p>Inspect compression activity, actual byte reduction and image token estimates.</p></div><Link className="v5-dashboard-settings-link" href="/dashboard/token-saver/settings">Compression settings<MotionIcon name="settings" /></Link></header><SaverWidgets enabled={sources.saver} renderSections={(aggregate) => <PxpipeWidgets enabled={sources.pxpipe} renderSections={(pxpipe) => <DashboardCanvas catalog={SAVER_WIDGETS} sections={{ ...aggregate, ...pxpipe }} initialLayout={layout} onSessionChange={onSessionChange} storageKey={SAVER_LAYOUT_KEY} persistLayout={persistLayout} />} />} /></div>;
}
