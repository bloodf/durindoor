import EmptyState from "./EmptyState";

const meta = {
  title: "Durin DS/Data/EmptyState",
  component: EmptyState,
  parameters: { layout: "centered" },
};

export default meta;

export const Default = {
  args: {
    icon: "inbox",
    title: "No connections yet",
    message: "Connections you add will appear here.",
  },
};

export const WithAction = {
  args: {
    icon: "key",
    title: "No API keys yet",
    message: "Create an API key to authenticate your tools.",
    action: {
      label: "Create API key",
      icon: "add",
      onClick: () => {},
    },
  },
};
