"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RequestLogger, CardSkeleton } from "@/shared/components";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import RangeSelector from "@/shared/ui/components/RangeSelector.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { USAGE_PERIOD_OPTIONS, getUsageCalendarCutoff, toLocalDateKey, addLocalCalendarDays } from "@/lib/usagePeriods.js";
import RequestDetailsTab from "@/app/(dashboard)/dashboard/usage/components/RequestDetailsTab";
import ComboUsageReport from "@/app/(dashboard)/dashboard/combos/components/ComboUsageReport.jsx";
import ApiKeyLimitsCard from "./ReviewApiKeyLimitsCard.jsx";

import ReviewUsageStats from "./ReviewUsageStats.jsx";
import UsageWidgetLayout from "./UsageWidgetLayout.jsx";
import MonitoringWidgets from "@/app/(dashboard)/dashboard/usage/components/MonitoringWidgets.jsx";

const PERIODS = USAGE_PERIOD_OPTIONS;

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

/** Storybook-only usage page. Widget customization changes review presentation, never gateway settings. */
export default function ReviewUsagePage({ initialLayout, persistLayout = true } = {}) {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent initialLayout={initialLayout} persistLayout={persistLayout} />
    </Suspense>
  );
}

function UsageContent({ initialLayout, persistLayout }) {
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
  const [resetError, setResetError] = useState("");
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

  /** Failed resets retain the displayed snapshot and selected range; review feedback allows retry. */
  const handleReset = async () => {
    setResetError("");
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
      setResetError("Reset failed. Your displayed usage is unchanged. Try again.");
    } finally {
      setResetting(false);
    }
  };

  const openResetModal = () => {
    setResetError("");
    setResetPeriod("all");
    setResetModalOpen(true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 text-[13px] sm:px-0">
      <div className="flex min-w-0 flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "logs", label: "Logs" },
            { value: "details", label: "Details" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
        />
        {activeTab === "overview" ? (
          <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <RangeSelector
              aria-label="Usage period"
              presets={PERIODS}
              value={selectValue === "custom"
                ? { preset: "custom", from: customRange.startDate, to: customRange.endDate }
                : { preset: period }}
              onChange={({ preset, from, to }) => {
                if (preset === "custom") handleRangeChange({ startDate: from, endDate: to });
                else handlePresetChange(preset);
              }}
              size="sm"
            />
            <Button variant="secondary" size="sm" icon="restart_alt" onClick={openResetModal} className="shrink-0">
              Reset
            </Button>
          </div>
        ) : null}
      </div>

      {activeTab === "overview" ? (
        <Suspense fallback={<CardSkeleton />}>
          <div className="flex flex-col gap-6">
            <ReviewUsageStats period={period} setPeriod={setPeriod} customRange={customRange} isCustomRange={selectValue === "custom"} hidePeriodSelector resetNonce={resetNonce}
              renderSections={(sections) => <UsageWidgetLayout initialLayout={initialLayout} persistLayout={persistLayout} sections={{ ...sections,
                combos: <ComboUsageReport period={period} customRange={customRange} resetNonce={resetNonce} />,
                keys: <ApiKeyLimitsCard />,
                monitoring: <MonitoringWidgets />,
              }} />}
            />
          </div>
        </Suspense>
      ) : null}
      {activeTab === "logs" ? <RequestLogger resetNonce={resetNonce} /> : null}
      {activeTab === "details" ? <RequestDetailsTab resetNonce={resetNonce} /> : null}

      <Modal
        open={resetModalOpen}
        onClose={() => { if (!resetting) setResetModalOpen(false); }}
        closeOnOverlay={!resetting}
        closeOnEscape={!resetting}
        pending={resetting}
        title="Reset usage data"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetModalOpen(false)} disabled={resetting}>Cancel</Button>
            <Button variant="danger" onClick={handleReset} loading={resetting} disabled={resetting}>Reset</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[13px] text-dd-muted">
          <p>Select how far back to delete usage data. This action cannot be undone.</p>
          {resetting ? <p role="status">Resetting usage data…</p> : null}
          {resetError ? <p role="alert">{resetError}</p> : null}
          <Select aria-label="Usage reset period" value={resetPeriod} options={RESET_PERIODS} onChange={setResetPeriod} disabled={resetting} />
        </div>
      </Modal>
    </div>
  );
}
