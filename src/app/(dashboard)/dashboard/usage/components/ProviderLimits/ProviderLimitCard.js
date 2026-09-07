"use client";

import { useState } from "react";
import { Card, CardHeader, CardContent } from "@/shared/ui/components/Card.jsx";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import QuotaProgressBar from "./QuotaProgressBar";
import { getRemainingPercentage } from "./utils";

const planTones = { free: "neutral", pro: "accent", ultra: "success", enterprise: "info" };

export default function ProviderLimitCard({ provider, name, plan, quotas = [], message = null, loading = false, error = null, onRefresh }) {
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };
  const title = name || provider;
  const planTone = planTones[plan?.toLowerCase()] || "neutral";
  return (
    <Card padding={false} className="flex flex-col gap-0">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><ProviderLogo provider={provider} size={28} />{title}</span>}
        actions={<>{plan ? <Badge tone={planTone} size="sm">{plan}</Badge> : null}<IconButton label="Refresh quota" icon={refreshing || loading ? "progress_activity" : "refresh"} onClick={handleRefresh} disabled={refreshing || loading} className={refreshing || loading ? "[&_span]:animate-spin" : undefined} /></>}
      />
      <CardContent className="flex flex-col gap-4">
        {loading ? <div className="flex flex-col gap-3" aria-label="Loading quota data"><div className="h-4 animate-pulse rounded-dd bg-dd-surface-3" /><div className="h-3 animate-pulse rounded-dd bg-dd-surface-3" /><div className="h-4 animate-pulse rounded-dd bg-dd-surface-3" /></div> : null}
        {!loading && error ? <div role="alert" className="flex items-start gap-2 rounded-dd border border-dd-danger bg-dd-surface-2 p-3 text-[13px] text-dd-danger"><span aria-hidden="true" className="material-symbols-outlined text-[18px]">error</span><p>{error}</p></div> : null}
        {!loading && !error && message ? <div className="flex items-start gap-2 rounded-dd border border-dd-info bg-dd-surface-2 p-3 text-[13px] text-dd-info"><span aria-hidden="true" className="material-symbols-outlined text-[18px]">info</span><p>{message}</p></div> : null}
        {!loading && !error && !message && quotas.length > 0 ? quotas.map((quota, index) => <QuotaProgressBar key={`${quota.name}-${index}`} label={quota.name} used={quota.used} total={quota.total} percentage={getRemainingPercentage(quota)} unlimited={quota.total === 0 || quota.total === null} resetTime={quota.resetAt} recurring={quota.recurring !== false} />) : null}
        {!loading && !error && !message && quotas.length === 0 ? <EmptyState icon="data_usage" title="No quota data available" /> : null}
      </CardContent>
    </Card>
  );
}
