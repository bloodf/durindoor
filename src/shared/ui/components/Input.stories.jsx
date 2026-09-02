import Input from "./Input.jsx";

/**
 * Durin DS — Input stories (group: Forms).
 * Solo, sizes, leading icon, disabled, and Field chrome (hint / error).
 */
const meta = {
  title: "Durin DS/Forms/Input",
  component: Input,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
};

export default meta;

export const Default = {
  render: () => <Input placeholder="sk-…" aria-label="API key" />,
};

export const WithIcon = {
  render: () => <Input icon="search" placeholder="Search providers…" aria-label="Search providers" />,
};

export const Small = {
  render: () => (
    <Input size="sm" icon="search" placeholder="Filter models…" aria-label="Filter models" />
  ),
};

export const Disabled = {
  render: () => <Input disabled defaultValue="sk-prod-key" aria-label="API key" />,
};

export const WithHint = {
  render: () => (
    <Input
      label="Base URL"
      hint="Leave empty to use the provider default."
      placeholder="https://api.example.com"
    />
  ),
};

export const WithError = {
  render: () => (
    <Input
      label="API key"
      error="This key failed validation against the provider."
      required
      defaultValue="sk-1234"
    />
  ),
};

export const Password = {
  render: () => (
    <Input
      type="password"
      label="Client secret"
      hint="Used only for OAuth token exchange."
      icon="lock"
      placeholder="••••••••"
    />
  ),
};
