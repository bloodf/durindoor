import KeyValue from "./KeyValue";

const apiKeyItems = [
  { icon: "calendar_today", label: "Created", value: "Aug 12, 2026" },
  { icon: "event_busy", label: "Expires", value: "Sep 12, 2026" },
  { icon: "deployed_code", label: "Models", value: "12 enabled", mono: true },
  { icon: "token", label: "Usage", value: "18,642,091 tokens", mono: true },
  { icon: "speed", label: "Daily limit", value: "2,000,000 tokens", mono: true },
];

const meta = {
  title: "Durin DS/Data/KeyValue",
  component: KeyValue,
  parameters: { layout: "centered" },
};

export default meta;

/** Controls-driven metadata row. */
export const Playground = {
  args: {
    items: [
      { icon: "calendar_today", label: "Created", value: "Aug 12, 2026" },
      { icon: "key", label: "Key ID", value: "sk_live_••••a71f", mono: true },
      { icon: "deployed_code", label: "Models", value: "12 enabled", mono: true },
    ],
  },
};

/** Dense API-key metadata for a detail panel or list footer. */
export const ApiKeyMetadata = {
  args: { items: apiKeyItems },
  render: (args) => (
    <div className="w-[42rem] max-w-full p-4">
      <KeyValue {...args} />
    </div>
  ),
};
