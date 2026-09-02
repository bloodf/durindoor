import { useState } from "react";
import Drawer from "./Drawer";

/**
 * Durin DS/Overlays — Drawer stories.
 *
 * `EditConnection` shows the canonical use: a form scrolling in the body
 * with actions pinned in the footer. `Wide` demonstrates the `width` prop
 * (inline style, clamped by max-w-full). Esc and backdrop click close both.
 */

const TRIGGER_CLASS =
  "h-9 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus";

const SECONDARY_CLASS =
  "h-9 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus";

const INPUT_CLASS =
  "h-9 w-full rounded-dd border border-dd-border bg-dd-surface px-3 text-[13px] text-dd-text outline-none placeholder:text-dd-subtle focus:border-dd-accent focus:shadow-dd-focus";

function Field({ label, placeholder, defaultValue, type = "text" }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-dd-muted">{label}</span>
      <input type={type} placeholder={placeholder} defaultValue={defaultValue} className={INPUT_CLASS} />
    </label>
  );
}

function EditConnectionDemo() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>
        Edit connection
      </button>
      <Drawer
        open={open}
        onClose={close}
        title="Edit connection"
        footer={
          <>
            <button type="button" className={SECONDARY_CLASS} onClick={close}>
              Cancel
            </button>
            <button type="button" className={TRIGGER_CLASS} onClick={close}>
              Save changes
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Connection name" defaultValue="Moria west gate" />
          <Field label="Base URL" placeholder="https://provider.example.com/v1" />
          <Field label="API key" placeholder="sk-…" type="password" />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dd-muted">Notes</span>
            <textarea
              rows={4}
              placeholder="Fallback order, quota caveats, owner…"
              className="w-full rounded-dd border border-dd-border bg-dd-surface px-3 py-2 text-[13px] text-dd-text outline-none placeholder:text-dd-subtle focus:border-dd-accent focus:shadow-dd-focus"
            />
          </label>
          <p className="text-xs text-dd-subtle">
            Changes apply to new requests only; in-flight streams keep the old
            credentials until they complete.
          </p>
        </div>
      </Drawer>
    </>
  );
}

function WideDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>
        Open wide drawer
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Request inspector" width={560}>
        <div className="flex flex-col gap-3">
          <p className="text-dd-muted">
            A 560px drawer for denser readouts — request payloads, stream
            traces, or side-by-side translations.
          </p>
          <pre className="rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3 font-mono text-xs text-dd-muted">
            {"POST /v1/chat/completions\nprovider: anthropic\nmodel: claude-sonnet-4\ntranslate: openai → claude"}
          </pre>
        </div>
      </Drawer>
    </>
  );
}

const meta = {
  title: "Durin DS/Overlays/Drawer",
  component: Drawer,
  parameters: { layout: "centered" },
};

export default meta;

export const EditConnection = {
  render: () => <EditConnectionDemo />,
};

export const Wide = {
  render: () => <WideDemo />,
};
