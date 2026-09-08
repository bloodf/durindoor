import { expect, userEvent, within } from "storybook/test";
import Tooltip from "./Tooltip";

const BUTTON_CLASS =
  "min-h-11 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus";

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
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "top" });
    await userEvent.hover(trigger);
    const bubble = await within(document.body).findByRole("tooltip");
    await Promise.all(bubble.getAnimations().map(({ finished }) => finished.catch(() => {})));
    await expect(bubble).toHaveTextContent("Moria stone above");
  },
};

export const Bottom = {
  render: () => <TooltipDemo side="bottom" content="Parchment below" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "bottom" });
    await userEvent.hover(trigger);
    const bubble = await within(document.body).findByRole("tooltip");
    await Promise.all(bubble.getAnimations().map(({ finished }) => finished.catch(() => {})));
    await expect(bubble).toHaveTextContent("Parchment below");
  },
};

export const Left = {
  render: () => <TooltipDemo side="left" content="West gate" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "left" });
    await userEvent.hover(trigger);
    const bubble = await within(document.body).findByRole("tooltip");
    await Promise.all(bubble.getAnimations().map(({ finished }) => finished.catch(() => {})));
    await expect(bubble).toHaveTextContent("West gate");
  },
};

export const Right = {
  render: () => <TooltipDemo side="right" content="East gate" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "right" });
    await userEvent.hover(trigger);
    const bubble = await within(document.body).findByRole("tooltip");
    await Promise.all(bubble.getAnimations().map(({ finished }) => finished.catch(() => {})));
    await expect(bubble).toHaveTextContent("East gate");
  },
};

export const LongText = {
  render: () => (
    <TooltipDemo
      side="top"
      content="Long descriptions wrap within viewport instead of escaping small screens or narrow rails."
    />
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "top" });
    await userEvent.hover(trigger);
    const bubble = await within(document.body).findByRole("tooltip");
    await Promise.all(bubble.getAnimations().map(({ finished }) => finished.catch(() => {})));
    await expect(bubble).toHaveTextContent("Long descriptions wrap within viewport instead of escaping small screens or narrow rails.");
  },
};

export const CollapsedParent = {
  render: () => (
    <div className="w-14 overflow-hidden border border-dd-border p-1">
      <Tooltip content="Visible beyond collapsed rail" side="right">
        <button type="button" aria-label="Collapsed navigation" className={BUTTON_CLASS}>
          Nav
        </button>
      </Tooltip>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Collapsed navigation" });
    await userEvent.hover(trigger);
    const bubble = await within(document.body).findByRole("tooltip");
    await Promise.all(bubble.getAnimations().map(({ finished }) => finished.catch(() => {})));
    await expect(bubble).toHaveTextContent("Visible beyond collapsed rail");
  },
};

export const Keyboard = {
  render: () => <TooltipDemo side="top" content="Keyboard description" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "top" })).toHaveFocus();
    await expect(await within(document.body).findByRole("tooltip")).toHaveTextContent("Keyboard description");
    await userEvent.keyboard("{Escape}");
    await expect(within(document.body).getByRole("tooltip", { hidden: true })).not.toBeVisible();
  },
};

export const Touch = {
  render: () => <TooltipDemo side="bottom" content="Touch description" />,
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "bottom" });
    await userEvent.pointer({ target: button, keys: "[TouchA]" });
    await expect(await within(document.body).findByRole("tooltip")).toHaveTextContent("Touch description");
  },
};
