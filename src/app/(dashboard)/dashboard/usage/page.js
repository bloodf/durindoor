"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl, ConfirmModal, Button, Select, DateRangePicker } from "@/shared/components";
import { USAGE_PERIOD_OPTIONS, getUsageCalendarCutoff, toLocalDateKey, addLocalCalendarDays } from "@/lib/usagePeriods.js";
import RequestDetailsTab from "./components/RequestDetailsTab";

const PERIODS = USAGE_PERIOD_OPTIONS;
// Appended to the preset list so a manually-edited calendar range has a label.
const CUSTOM_PERIOD = { value: "custom", label: "Custom", disabled: true };

/**
 * Map a preset period id to a `{ startDate, endDate }` pair (YYYY-MM-DD) for the
 * calendar display. The actual usage query is always the exact preset (e.g.
 * period=24h uses a rolling 24h window); native date inputs are date-only, so
 * `today`/`24h`/`all` are special-cased as calendar approximations: today =
 * today, 24h ≈ yesterday (date-only), all = empty start (no lower bound).
 * @returns {{ startDate: string, endDate: string }}
 */
function presetToRange(preset) {
  const endDate = toLocalDateKey(new Date());
  if (preset === "today") return { startDate: endDate, endDate };
  if (preset === "24h") return { startDate: toLocalDateKey(addLocalCalendarDays(new Date(), -1)), endDate };
  if (preset === "all") return { startDate: "", endDate };
  const cutoff = getUsageCalendarCutoff(preset);
  return { startDate: cutoff ? toLocalDateKey(cutoff) : "", endDate };
}

const RESET_PERIODS = [
  { value: "5m", label: "5 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "3h", label: "3 hours" },
  { value: "6h", label: "6 hours" },
  { value: "12h", label: "12 hours" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // `period` is a valid preset; `customRange` is the calendar's window. Selecting
  // a preset syncs the calendar to that preset's computed start/end. Editing the
  // calendar to a window that diverges from the preset flips the Select to
  // "Custom" and re-queries the stats/table via startDate/endDate (the chart,
  // whose endpoint is preset-only, is replaced by an honest note while custom).
  const [customRange, setCustomRange] = useState(() => presetToRange("today"));
  const [period, setPeriod] = useState("today");
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetPeriod, setResetPeriod] = useState("all");
  const [resetting, setResetting] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);

  // Select shows "custom" whenever the calendar diverges from the active preset.
  const selectValue = useMemo(() => {
    const preset = presetToRange(period);
    return preset.startDate === customRange.startDate && preset.endDate === customRange.endDate
      ? period
      : "custom";
  }, [period, customRange]);

  const handlePresetChange = (value) => {
    if (value === "custom") return; // Custom is reached only by editing the calendar.
    setPeriod(value);
    setCustomRange(presetToRange(value));
  };

  const handleRangeChange = ({ startDate, endDate }) => setCustomRange({ startDate, endDate });

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await fetch("/api/usage/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: resetPeriod }),
      });
      if (!res.ok) throw new Error("Reset failed");
      setResetModalOpen(false);
      // Force all usage tabs to refetch without touching the selected period
      setResetNonce((n) => n + 1);
    } catch (e) {
      console.error("Reset failed:", e);
    } finally {
      setResetting(false);
    }
  };

  const openResetModal = () => {
    setResetPeriod("all");
    setResetModalOpen(true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Keep tabs left and periods right on one line without overlap */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="relative z-20 shrink-0">
          <SegmentedControl
            options={[
              { value: "overview", label: "Overview" },
              { value: "details", label: "Details" },
            ]}
            value={activeTab}
            onChange={handleTabChange}
            className="w-auto shrink-0"
          />
        </div>
        {activeTab === "overview" && (
          <div className="flex min-w-0 flex-1 flex-col items-stretch justify-end gap-2 sm:flex-row sm:items-center sm:overflow-visible">
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
              <Select
                aria-label="Usage period preset"
                options={[...PERIODS, CUSTOM_PERIOD]}
                value={selectValue}
                onChange={(e) => handlePresetChange(e.target.value)}
                placeholder="Period"
                className="min-w-[8rem]"
              />
              <DateRangePicker
                startDate={customRange.startDate}
                endDate={customRange.endDate}
                onChange={handleRangeChange}
              />
              {selectValue === "custom" && (
                <p className="w-full text-xs text-text-muted sm:w-auto">
                  Custom range is a visual selection — pick a preset to refetch stats.
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              icon="restart_alt"
              onClick={openResetModal}
              className="shrink-0"
            >
              Reset
            </Button>
          </div>
        )}
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats period={period} setPeriod={setPeriod} customRange={customRange} isCustomRange={selectValue === "custom"} hidePeriodSelector resetNonce={resetNonce} />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger resetNonce={resetNonce} />}
      {activeTab === "details" && <RequestDetailsTab resetNonce={resetNonce} />}

      {/* Reset Confirmation Modal */}
      <ConfirmModal
        isOpen={resetModalOpen}
        onClose={() => !resetting && setResetModalOpen(false)}
        onConfirm={handleReset}
        title="Reset Usage Data"
        message={
          <div className="space-y-3">
            <p className="text-text-muted">
              Select how far back you want to delete usage data. This action cannot be undone.
            </p>
            <select
              value={resetPeriod}
              onChange={(e) => setResetPeriod(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              {RESET_PERIODS.map((rp) => (
                <option key={rp.value} value={rp.value}>
                  {rp.label}
                </option>
              ))}
            </select>
          </div>
        }
        confirmText={resetting ? "Resetting..." : "Reset"}
        variant="danger"
        loading={resetting}
      />
    </div>
  );
}
