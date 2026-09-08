"use client";

import PropTypes from "prop-types";
import StatCard from "@/shared/ui/components/StatCard.jsx";
import { formatCompactToken } from "@/shared/utils/formatCompact";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const compactToken = (n) => formatCompactToken(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      <StatCard icon="query_stats" label="Total requests" value={fmt(stats.totalRequests)} />
      <StatCard
        icon="input"
        label="Total input tokens"
        tone="accent"
        value={<span role="img" title={compactToken(stats.totalPromptTokens).title} aria-label={compactToken(stats.totalPromptTokens).title}>{compactToken(stats.totalPromptTokens).display}</span>}
      />
      <StatCard
        icon="cached"
        label="Cached tokens"
        tone="default"
        value={<span role="img" title={compactToken(stats.totalCachedTokens).title} aria-label={compactToken(stats.totalCachedTokens).title}>{compactToken(stats.totalCachedTokens).display}</span>}
      />
      <StatCard
        icon="output"
        label="Output tokens"
        tone="success"
        value={<span role="img" title={compactToken(stats.totalCompletionTokens).title} aria-label={compactToken(stats.totalCompletionTokens).title}>{compactToken(stats.totalCompletionTokens).display}</span>}
      />
      <StatCard icon="payments" label="Est. cost" tone="warning" value={`~${fmtCost(stats.totalCost)}`} hint="Estimated, not actual billing" />
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
