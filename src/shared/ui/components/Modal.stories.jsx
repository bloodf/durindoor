import { useState } from "react";
import Modal from "./Modal";

/**
 * Durin DS/Overlays — Modal stories.
 *
 * Every story is interactive: click the trigger to open, then verify Esc,
 * backdrop click and the close button all dismiss, and that body scroll is
 * locked while open. `LongContentScrolling` proves the body area scrolls
 * inside the panel (header/footer stay pinned) on a max-h-[85vh] panel.
 */

const TRIGGER_CLASS =
  "h-9 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus";

const SECONDARY_CLASS =
  "h-9 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus";

function ModalDemo({ size, title, subtitle, withFooter = true, children, triggerLabel }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      <Modal
        open={open}
        onClose={close}
        size={size}
        title={title}
        subtitle={subtitle}
        footer={
          withFooter ? (
            <>
              <button type="button" className={SECONDARY_CLASS} onClick={close}>
                Cancel
              </button>
              <button type="button" className={TRIGGER_CLASS} onClick={close}>
                Save changes
              </button>
            </>
          ) : undefined
        }
      >
        {children}
      </Modal>
    </>
  );
}

const meta = {
  title: "Durin DS/Overlays/Modal",
  component: Modal,
  parameters: { layout: "centered" },
};

export default meta;

export const Small = {
  render: () => (
    <ModalDemo size="sm" title="Rename connection" triggerLabel="Open small modal">
      <p className="text-dd-muted">
        The smallest dialog, sized for short forms and simple confirmations.
      </p>
    </ModalDemo>
  ),
};

export const Medium = {
  render: () => (
    <ModalDemo
      size="md"
      title="Edit combo engineer"
      subtitle="Changes apply to every route using this combo."
      triggerLabel="Open medium modal"
    >
      <p className="text-dd-muted">
        The default size. A subtitle renders under the title, and the footer
        holds the right-aligned action buttons.
      </p>
    </ModalDemo>
  ),
};

export const Large = {
  render: () => (
    <ModalDemo size="lg" title="Usage report" triggerLabel="Open large modal">
      <p className="text-dd-muted">
        The widest dialog, for dense content such as tables or diffs.
      </p>
    </ModalDemo>
  ),
};

export const WithoutFooter = {
  render: () => (
    <ModalDemo
      size="sm"
      title="About DurinDoor"
      withFooter={false}
      triggerLabel="Open modal without footer"
    >
      <p className="text-dd-muted">
        One endpoint for all your AI providers. The footer area is omitted
        entirely when no actions are passed.
      </p>
    </ModalDemo>
  ),
};

const LORE_PARAGRAPHS = [
  "The Mines of Moria stretch far beneath the Misty Mountains, level upon level of hewn stone and forgotten halls.",
  "Durin's folk delved too greedily and too deep, and woke the shadow that drove them from Khazad-dûm.",
  "Every gateway key you mint opens one door. Rotate it the moment you suspect a tunnel has been watched.",
  "Combo engineers chain providers the way dwarven masons chain counterweights: each link bears load, and the weakest sets the limit.",
  "Tabular metrics line up like columns in the great hall — use .dd-tnum so the digits never drift.",
  "A fallback route is a side passage: mapped in advance, lit, and never first choice.",
  "Token budgets are mithril. Spend them where the seam is richest, never on rubble.",
  "The watcher in the water took no heed of passwords spoken in haste. Speak friend, and validate.",
  "When a provider answers with 429, retreat down the fallback chain before the bridge crumbles.",
  "Records of every request are kept in the Chronicle of the lower levels; prune them on schedule.",
  "Even the smallest key can open the deepest door, provided its checksum is true.",
  "Thus ends the long-content demonstration: the header and footer held fast while the body scrolled.",
];

export const LongContentScrolling = {
  render: () => (
    <ModalDemo
      size="md"
      title="Chronicle of the lower levels"
      subtitle="Twelve entries, scrollable"
      triggerLabel="Open long-content modal"
    >
      <div className="flex flex-col gap-3">
        {LORE_PARAGRAPHS.map((text) => (
          <p key={text.slice(0, 24)} className="text-dd-muted">
            {text}
          </p>
        ))}
      </div>
    </ModalDemo>
  ),
};
