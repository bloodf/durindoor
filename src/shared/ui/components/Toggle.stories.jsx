import { useState } from "react";
import Toggle from "./Toggle";

/**
 * Durin DS/Choice — Toggle stories.
 *
 * Static exports pin the meaningful states (on/off, sm/md, disabled, with
 * label/description); stateful wrappers keep every story clickable. The
 * SettingsCard export is the composition proof: Toggle rows inside a
 * settings-style card. No story sets an explicit background — the toolbar
 * "Theme" toggle flips dark "Moria stone" / light "Parchment".
 */

/** Stateful wrapper so CSF3 `render` functions stay hook-free. */
function StatefulToggle({ checked: initial = false, ...props }) {
  const [checked, setChecked] = useState(initial);
  return <Toggle {...props} checked={checked} onChange={setChecked} />;
}

function SettingsCardDemo() {
  const [settings, setSettings] = useState({ stream: true, usage: true, debug: false });
  const update = (key) => (next) => setSettings((prev) => ({ ...prev, [key]: next }));

  return (
    <div className="w-[380px] rounded-dd-lg border border-dd-border bg-dd-surface shadow-dd-elevated">
      <div className="border-b border-dd-border-subtle px-4 py-3">
        <h3 className="text-sm font-semibold text-dd-text">Gateway</h3>
        <p className="mt-0.5 text-xs text-dd-muted">
          Request handling for this endpoint.
        </p>
      </div>
      <div className="divide-y divide-dd-border-subtle">
        <div className="px-4 py-3">
          <Toggle
            label="Stream responses"
            description="Proxy tokens as they arrive instead of buffering."
            checked={settings.stream}
            onChange={update("stream")}
          />
        </div>
        <div className="px-4 py-3">
          <Toggle
            label="Usage tracking"
            description="Record token counts and cost per request."
            checked={settings.usage}
            onChange={update("usage")}
          />
        </div>
        <div className="px-4 py-3">
          <Toggle
            label="Debug logging"
            description="Verbose request logs. Not recommended in production."
            checked={settings.debug}
            onChange={update("debug")}
          />
        </div>
        <div className="px-4 py-3">
          <Toggle
            label="Beta providers"
            description="Unavailable on the current plan."
            checked={false}
            disabled
          />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Durin DS/Choice/Toggle",
  component: Toggle,
  parameters: { layout: "centered" },
};

export default meta;

export const Default = {
  render: (args) => <StatefulToggle {...args} />,
  args: {
    checked: true,
    label: "Stream responses",
    description: "Proxy tokens as they arrive instead of buffering.",
  },
};

export const Off = {
  args: { checked: false, "aria-label": "Stream responses" },
};

export const On = {
  args: { checked: true, "aria-label": "Stream responses" },
};

export const Sizes = {
  render: () => (
    <div className="flex flex-col gap-4">
      <StatefulToggle size="md" checked label="Medium (md) — 36×20px track" />
      <StatefulToggle size="sm" checked label="Small (sm) — 30×17px track" />
    </div>
  ),
};

export const Disabled = {
  render: () => (
    <div className="flex w-[340px] flex-col gap-5">
      <div className="flex items-center gap-6">
        <Toggle checked={false} disabled aria-label="Disabled off" />
        <Toggle checked disabled aria-label="Disabled on" />
      </div>
      <Toggle
        checked={false}
        disabled
        label="Beta providers"
        description="Unavailable on the current plan."
      />
    </div>
  ),
};

export const SettingsCard = {
  render: () => <SettingsCardDemo />,
};
