"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { formatNumber, formatUsd, meterBarClass } from "@/app/(dashboard)/dashboard/endpoint/components/ApiKeyLimits";
import { KEY_USAGE_POLL_MS } from "@/app/(dashboard)/dashboard/endpoint/endpointConstants";

function formatReset(resetAt) {
  if (!resetAt) return "Rolling 60s";
  const ms = new Date(resetAt).getTime() - Date.now();
  if (ms <= 0) return "Now";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 48) return new Date(resetAt).toLocaleDateString();
  return hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
}

// Only the limits that are set, per-minute windows first.
function configuredLimits(usage) {
  const rows = [];
  if (usage.rpm?.limit != null) {
    rows.push({ field: "rpmLimit", label: "Requests / minute", used: usage.rpm.used, limit: usage.rpm.limit, money: false, resetAt: null });
  }
  if (usage.tpm?.limit != null) {
    rows.push({ field: "tpmLimit", label: "Tokens / minute", used: usage.tpm.used, limit: usage.tpm.limit, money: false, resetAt: null });
  }
  for (const l of usage.limits || []) if (l.limit != null) rows.push(l);
  return rows;
}

function LimitRow({ row }) {
  const format = row.money ? formatUsd : formatNumber;
  const ratio = row.used / row.limit;
  const exhausted = row.used >= row.limit;
  return (
    <tr className="border-t border-dd-border-subtle">
      <td className="px-4 py-2.5">{row.label}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono">
        {format(row.used)} <span className="text-dd-muted">/ {format(row.limit)}</span>
      </td>
      <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono ${exhausted ? "font-semibold text-dd-danger" : ""}`}>
        {exhausted ? "Exhausted" : format(Math.max(row.limit - row.used, 0))}
      </td>
      <td className="min-w-[140px] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-dd-surface-2">
            <div className={`h-full rounded-full ${meterBarClass(ratio)}`} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
          </div>
          <span className="w-10 text-right text-xs text-dd-muted">{Math.min(Math.round(ratio * 100), 999)}%</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right text-dd-muted">{formatReset(row.resetAt)}</td>
    </tr>
  );
}

LimitRow.propTypes = { row: PropTypes.object.isRequired };

/** Usage overview card: each key's configured limits, used and remaining. */
export default function ApiKeyLimitsCard() {
  const [keys, setKeys] = useState(null);
  const [usage, setUsage] = useState({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [keysRes, usageRes] = await Promise.all([
          fetch("/api/keys", { cache: "no-store" }),
          fetch("/api/keys/usage", { cache: "no-store" }),
        ]);
        const keysData = keysRes.ok ? (await keysRes.json()).keys || [] : null;
        const usageData = usageRes.ok ? (await usageRes.json()).usage || {} : null;
        if (cancelled) return;
        if (keysData) setKeys(keysData);
        if (usageData) setUsage(usageData);
      } catch { /* keep the last data; the card is best-effort */ }
    };
    load();
    const timer = setInterval(load, KEY_USAGE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!keys || keys.length === 0) return null;

  const withRows = keys
    .map((key) => ({ key, rows: usage[key.id] ? configuredLimits(usage[key.id]) : [] }))
    .sort((a, b) => (b.rows.length > 0) - (a.rows.length > 0));

  return (
    <Card padding={false} className="flex min-w-0 flex-col gap-0">
      <CardHeader
        icon="speed"
        title="API key limits"
        subtitle="Current usage against each key's limits. Daily limits reset at the server's midnight, monthly ones on the 1st."
      />
      <CardContent className="flex flex-col gap-4">
        {withRows.map(({ key, rows }) => (
          <div key={key.id} className="min-w-0">
            <div className="flex items-center gap-2 pb-1.5">
              <span className="text-[13px] font-medium text-dd-text">{key.name}</span>
              {key.isActive === false ? <Badge tone="warning" size="sm">Paused</Badge> : null}
              {rows.some((r) => r.used >= r.limit) ? <Badge tone="danger" size="sm">Limit reached</Badge> : null}
            </div>
            {rows.length === 0 ? (
              <p className="text-xs text-dd-muted">No limits set. Edit them on the Keys page.</p>
            ) : (
              <div className="overflow-x-auto rounded-dd border border-dd-border">
                <table className="w-full text-[13px]">
                  <thead className="bg-dd-surface-2 text-xs uppercase text-dd-muted">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Limit</th>
                      <th className="px-4 py-2 text-right font-semibold">Used</th>
                      <th className="px-4 py-2 text-right font-semibold">Remaining</th>
                      <th className="px-4 py-2 text-left font-semibold">Usage</th>
                      <th className="px-4 py-2 text-right font-semibold">Resets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => <LimitRow key={row.field} row={row} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
