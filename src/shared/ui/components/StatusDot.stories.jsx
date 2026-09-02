/**
 * Durin DS — StatusDot stories (group: Surfaces).
 *
 * Covers every tone (success/warning/danger/info/neutral), the `pulse` ring
 * for live/running states, and labels. Stories set no backgrounds — the
 * "Theme" toolbar toggle drives dark/light.
 */
import { StatusDot } from "./StatusDot.jsx";

const meta = {
  title: "Durin DS/Surfaces/StatusDot",
  component: StatusDot,
  parameters: { layout: "centered" },
  argTypes: {
    tone: {
      control: "select",
      options: ["success", "warning", "danger", "info", "neutral"],
    },
    pulse: { control: "boolean" },
    label: { control: "text" },
  },
};

export default meta;

/** Controls-driven single dot. */
export const Playground = {
  args: { tone: "success", pulse: false, label: "Live" },
};

/** All five tones, bare and with labels. */
export const Tones = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <div className="flex items-center gap-4">
        <StatusDot tone="success" />
        <StatusDot tone="warning" />
        <StatusDot tone="danger" />
        <StatusDot tone="info" />
        <StatusDot tone="neutral" />
      </div>
      <div className="flex items-center gap-4">
        <StatusDot tone="success" label="Connected" />
        <StatusDot tone="warning" label="Degraded" />
        <StatusDot tone="danger" label="Failed" />
        <StatusDot tone="info" label="Syncing" />
        <StatusDot tone="neutral" label="Idle" />
      </div>
    </div>
  ),
};

/** `pulse` marks live/running states with a subtle animated ring. */
export const Pulse = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <StatusDot tone="success" pulse label="Streaming" />
      <StatusDot tone="info" pulse label="Indexing" />
      <StatusDot tone="warning" pulse label="Retrying" />
      <div className="mt-1 flex items-center gap-4">
        <StatusDot tone="success" pulse />
        <StatusDot tone="danger" pulse />
        <StatusDot tone="neutral" pulse />
      </div>
    </div>
  ),
};

/** Dots inline inside a connection list. */
export const InContext = {
  render: () => (
    <div className="flex w-80 flex-col gap-1">
      {[
        { name: "OpenAI", tone: "success", pulse: true, label: "Live" },
        { name: "Anthropic", tone: "warning", pulse: false, label: "Rate limited" },
        { name: "Kiro", tone: "danger", pulse: false, label: "Auth expired" },
        { name: "Ollama", tone: "neutral", pulse: false, label: "Stopped" },
      ].map((row) => (
        <div
          key={row.name}
          className="flex items-center justify-between rounded-dd px-2 py-1.5"
        >
          <span className="text-[13px] text-dd-text">{row.name}</span>
          <StatusDot tone={row.tone} pulse={row.pulse} label={row.label} />
        </div>
      ))}
    </div>
  ),
};
