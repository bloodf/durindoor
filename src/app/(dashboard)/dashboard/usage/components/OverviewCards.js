"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import { formatCompactToken } from "@/shared/utils/formatCompact";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const compactToken = (n) => formatCompactToken(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Total Requests</span>
        <span className="truncate text-2xl font-bold">{fmt(stats.totalRequests)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Total Input Tokens</span>
        <span className="truncate text-2xl font-bold text-primary">{<span className="dd-tnum" title={compactToken(stats.totalPromptTokens).title} aria-label={compactToken(stats.totalPromptTokens).title}>{compactToken(stats.totalPromptTokens).display}</span>}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Cached Tokens</span>
        <span className="truncate text-2xl font-bold text-info">{<span className="dd-tnum" title={compactToken(stats.totalCachedTokens).title} aria-label={compactToken(stats.totalCachedTokens).title}>{compactToken(stats.totalCachedTokens).display}</span>}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Output Tokens</span>
        <span className="truncate text-2xl font-bold text-success">{<span className="dd-tnum" title={compactToken(stats.totalCompletionTokens).title} aria-label={compactToken(stats.totalCompletionTokens).title}>{compactToken(stats.totalCompletionTokens).display}</span>}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Est. Cost</span>
        <span className="truncate text-2xl font-bold text-warning">~{fmtCost(stats.totalCost)}</span>
        <span className="text-[10px] text-text-muted">Estimated, not actual billing</span>
      </Card>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
