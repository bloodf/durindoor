import DsTooltip from "@/shared/ui/components/Tooltip.jsx";

/** Inline help tooltip preserving its existing `text` API. */
export default function Tooltip({ text }) {
  return (
    <DsTooltip content={text} side="right">
      <button type="button" className="inline-flex size-11 items-center justify-center rounded-dd text-dd-muted outline-none focus-visible:shadow-dd-focus" aria-label="More information">
        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">help</span>
      </button>
    </DsTooltip>
  );
}
