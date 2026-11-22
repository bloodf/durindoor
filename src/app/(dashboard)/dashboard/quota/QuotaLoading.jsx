"use client";

import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";

export default function QuotaLoading() {
  const uiV5 = useUiV5();
  return <div className="grid gap-4 md:grid-cols-2" {...(uiV5 ? { role: "status", "aria-label": "Loading quota" } : {})}><div className="h-40 animate-pulse rounded-dd-lg bg-dd-surface-2" /><div className="h-40 animate-pulse rounded-dd-lg bg-dd-surface-2" /></div>;
}
