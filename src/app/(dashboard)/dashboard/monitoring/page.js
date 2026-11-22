"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import MonitoringWidget from "@/shared/ui/v5/dashboards/MonitoringWidget.jsx";

export default function MonitoringPage() {
  const v5 = useUiV5();
  const router = useRouter();
  useEffect(() => { if (!v5) router.replace("/dashboard/usage"); }, [v5, router]);
  if (!v5) return null;
  return <div className="v5-dashboard-page"><header className="v5-dashboard-page-heading"><div><h1>Monitoring</h1><p>Live gateway, activity, latency and storage measurements.</p></div></header><MonitoringWidget /></div>;
}
