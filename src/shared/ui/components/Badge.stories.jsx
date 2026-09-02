/**
 * Durin DS — Badge stories (group: Surfaces).
 *
 * Covers every tone (neutral/accent/success/warning/danger/info), both sizes,
 * and icon usage. Stories set no backgrounds — the "Theme" toolbar toggle
 * drives dark/light.
 */
import { Badge } from "./Badge.jsx";

const meta = {
  title: "Durin DS/Surfaces/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  argTypes: {
    tone: {
      control: "select",
      options: ["neutral", "accent", "success", "warning", "danger", "info"],
    },
    size: { control: "radio", options: ["sm", "md"] },
    icon: { control: "text" },
  },
};

export default meta;

/** Controls-driven single badge. */
export const Playground = {
  args: { tone: "neutral", size: "md", icon: "", children: "Badge" },
};

/** All six tones at both sizes. */
export const Tones = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">Neutral</Badge>
        <Badge tone="accent">Accent</Badge>
        <Badge tone="success">Success</Badge>
        <Badge tone="warning">Warning</Badge>
        <Badge tone="danger">Danger</Badge>
        <Badge tone="info">Info</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral" size="sm">Neutral</Badge>
        <Badge tone="accent" size="sm">Accent</Badge>
        <Badge tone="success" size="sm">Success</Badge>
        <Badge tone="warning" size="sm">Warning</Badge>
        <Badge tone="danger" size="sm">Danger</Badge>
        <Badge tone="info" size="sm">Info</Badge>
      </div>
    </div>
  ),
};

/** Leading Material Symbols icons at both sizes. */
export const WithIcons = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="success" icon="check_circle">Healthy</Badge>
        <Badge tone="warning" icon="warning">Degraded</Badge>
        <Badge tone="danger" icon="error">Offline</Badge>
        <Badge tone="info" icon="info">Beta</Badge>
        <Badge tone="accent" icon="bolt">Default</Badge>
        <Badge tone="neutral" icon="smart_toy">12 models</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="success" size="sm" icon="check_circle">Healthy</Badge>
        <Badge tone="danger" size="sm" icon="error">Offline</Badge>
        <Badge tone="accent" size="sm" icon="bolt">Default</Badge>
      </div>
    </div>
  ),
};

/** Semantic usage in context: statuses stay semantic, gold marks featured. */
export const InContext = {
  render: () => (
    <div className="flex w-96 flex-col gap-2">
      {[
        { name: "openai/gpt-5", badge: <Badge tone="success" size="sm" icon="check_circle">Healthy</Badge> },
        { name: "anthropic/claude-sonnet-4.5", badge: <Badge tone="warning" size="sm" icon="warning">Rate limited</Badge> },
        { name: "gemini/gemini-3-pro", badge: <Badge tone="info" size="sm" icon="science">Beta</Badge> },
        { name: "local/llama-4-scout", badge: <Badge tone="neutral" size="sm">Idle</Badge> },
      ].map((row) => (
        <div
          key={row.name}
          className="flex items-center justify-between rounded-dd border border-dd-border bg-dd-surface px-3 py-2"
        >
          <span className="font-mono text-[13px] text-dd-text">{row.name}</span>
          {row.badge}
        </div>
      ))}
    </div>
  ),
};
