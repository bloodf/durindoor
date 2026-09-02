import Textarea from "./Textarea";

/** Durin DS — Textarea stories (group: Forms). */
const meta = {
  title: "Durin DS/Forms/Textarea",
  component: Textarea,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export default meta;

export const Default = {
  render: () => <Textarea placeholder="Add deployment notes…" aria-label="Deployment notes" />,
};

export const WithHint = {
  render: () => (
    <Textarea
      label="System prompt"
      hint="This instruction is included with every request."
      placeholder="You are a helpful assistant…"
    />
  ),
};

export const WithError = {
  render: () => (
    <Textarea
      label="Webhook payload"
      error="Payload must contain valid JSON."
      required
      defaultValue="{ event: deployment.completed }"
    />
  ),
};

export const Disabled = {
  render: () => (
    <Textarea
      label="Archived notes"
      disabled
      defaultValue="This deployment has been archived and can no longer be edited."
    />
  ),
};
