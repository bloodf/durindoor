"use client";

import MotionIcon from "../motion/MotionIcon.jsx";
import DashboardCanvas from "./DashboardCanvas.jsx";
import SaverWidgets from "./SaverWidgets.jsx";
import PxpipeWidgets from "./PxpipeWidgets.jsx";
import { SAVER_LAYOUT_KEY, SAVER_WIDGETS } from "./model.js";
import "./dashboards.css";

/** Review-only dashboard; compression settings remain at their existing dedicated route. */
export default function TokenSaverDashboard({ initialLayout, persistLayout = false }) {
  return <div className="v5-dashboard-page"><header className="v5-dashboard-page-heading"><div><h1>Token Saver dashboard</h1><p>Inspect compression activity, actual byte reduction and image token estimates.</p></div><a className="v5-dashboard-settings-link" href="/dashboard/token-saver/settings">Compression settings<MotionIcon name="settings" /></a></header><SaverWidgets renderSections={(aggregate) => <PxpipeWidgets renderSections={(pxpipe) => <DashboardCanvas catalog={SAVER_WIDGETS} sections={{ ...aggregate, ...pxpipe }} initialLayout={initialLayout} storageKey={SAVER_LAYOUT_KEY} persistLayout={persistLayout} />} />} /></div>;
}
