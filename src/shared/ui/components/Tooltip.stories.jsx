import Tooltip from "./Tooltip";

/**
 * Durin DS/Overlays — Tooltip stories.
 *
 * Pure CSS visibility: hover the trigger or tab to it (focus-within shows
 * the bubble for keyboard users). Triggers are real buttons so focus works
 * without extra tabIndex. All four sides are covered individually, then
 * together in `AllSides` for a single visual sweep.
 */

const BUTTON_CLASS =
  "h-9 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus";

function TooltipDemo({ side, content }) {
  return (
    <Tooltip content={content} side={side}>
      <button type="button" className={BUTTON_CLASS}>
        {side}
      </button>
    </Tooltip>
  );
}

const meta = {
  title: "Durin DS/Overlays/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
};

export default meta;

export const Top = {
  render: () => <TooltipDemo side="top" content="Moria stone above" />,
};

export const Bottom = {
  render: () => <TooltipDemo side="bottom" content="Parchment below" />,
};

export const Left = {
  render: () => <TooltipDemo side="left" content="West gate" />,
};

export const Right = {
  render: () => <TooltipDemo side="right" content="East gate" />,
};

export const AllSides = {
  render: () => (
    <div className="grid grid-cols-2 gap-x-16 gap-y-16">
      <TooltipDemo side="top" content="Tooltip on top" />
      <TooltipDemo side="bottom" content="Tooltip on bottom" />
      <TooltipDemo side="left" content="Tooltip on the left" />
      <TooltipDemo side="right" content="Tooltip on the right" />
    </div>
  ),
};
