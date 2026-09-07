"use client";

import { formatResetTime } from "./utils";

const TONES = {
  healthy: { text: "text-dd-success", bar: "bg-dd-success", surface: "bg-dd-surface-2", label: "Healthy" },
  warning: { text: "text-dd-warning", bar: "bg-dd-warning", surface: "bg-dd-surface-2", label: "Low" },
  danger: { text: "text-dd-danger", bar: "bg-dd-danger", surface: "bg-dd-surface-2", label: "Depleted" },
};

function toneFor(remaining) {
  if (remaining > 70) return TONES.healthy;
  if (remaining >= 30) return TONES.warning;
  return TONES.danger;
}

function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;
  try {
    const resetDate = new Date(resetTime);
    const now = new Date();
    const isToday = resetDate.toDateString() === now.toDateString();
    const isTomorrow = resetDate.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    const timeStr = resetDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
    if (isToday) return `Today, ${timeStr}`;
    if (isTomorrow) return `Tomorrow, ${timeStr}`;
    return resetDate.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return null;
  }
}

export default function QuotaProgressBar({ percentage = 0, label = "", used = 0, total = 0, unlimited = false, resetTime = null, recurring = true }) {
  const safeUsed = Number.isFinite(Number(used)) ? Number(used) : 0;
  const safeTotal = Number.isFinite(Number(total)) ? Number(total) : 0;
  const remaining = Math.max(0, Math.min(Number(percentage) || 0, 100));
  const tone = toneFor(remaining);
  const countdown = formatResetTime(resetTime);
  const resetDisplay = formatResetTimeDisplay(resetTime);
  const resetWord = recurring ? "Reset" : "Expires";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate font-semibold text-dd-text">{label}</span>
        <span className={`shrink-0 font-medium dd-tnum ${tone.text}`}>{unlimited ? "Unlimited" : `${remaining}%`}</span>
      </div>
      {!unlimited ? (
        <div className={`h-2 overflow-hidden rounded-dd ${tone.surface}`} role="progressbar" aria-label={`${label} quota remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}>
          <div className={`h-full rounded-dd transition-[width] motion-reduce:transition-none ${tone.bar}`} style={{ width: `${remaining}%` }} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-dd-muted">
        <span className="dd-tnum">{safeUsed.toLocaleString()} / {unlimited ? "∞" : safeTotal.toLocaleString()} requests</span>
        {countdown !== "-" ? <span className="font-medium">{resetWord} in {countdown}</span> : null}
      </div>
      {resetDisplay ? <span className="text-xs text-dd-subtle">{resetWord} at {resetDisplay}</span> : null}
    </div>
  );
}
