"use client";

import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";

export const WINDOW_PRESETS = [
  { value: "5m", label: "5m", ms: 5 * 60_000 },
  { value: "15m", label: "15m", ms: 15 * 60_000 },
  { value: "1h", label: "1h", ms: 60 * 60_000 },
  { value: "6h", label: "6h", ms: 6 * 60 * 60_000 },
];
export const DEFAULT_WINDOW = "15m";

export const LANE_OPTIONS = [
  { value: "provider", label: "Provider" },
  { value: "connection_id", label: "Connection" },
];
export const DEFAULT_LANE = "provider";

export function resolveWindow(value) {
  return WINDOW_PRESETS.find((preset) => preset.value === value) ?? WINDOW_PRESETS.find((preset) => preset.value === DEFAULT_WINDOW);
}

export function resolveLane(value) {
  return LANE_OPTIONS.some((option) => option.value === value) ? value : DEFAULT_LANE;
}

/**
 * Window preset, lane grouping, and live toggle for the swimlane view. The
 * page owns the EventSource; this only flips `live`.
 */
export default function TimelineWindowControls({ windowKey = DEFAULT_WINDOW, onWindowChange, laneBy = DEFAULT_LANE, onLaneByChange, live = false, onLiveChange }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl
        aria-label="Time window"
        size="sm"
        options={WINDOW_PRESETS.map(({ value, label }) => ({ value, label }))}
        value={resolveWindow(windowKey).value}
        onChange={onWindowChange}
      />
      <div className="w-40">
        <Select aria-label="Group lanes by" size="sm" options={LANE_OPTIONS} value={resolveLane(laneBy)} onChange={onLaneByChange} />
      </div>
      <Toggle checked={live} onChange={onLiveChange} label="Live" aria-label="Live timeline updates" />
    </div>
  );
}
