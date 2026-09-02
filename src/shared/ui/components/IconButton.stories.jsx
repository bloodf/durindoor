import Button from "./Button";
import IconButton from "./IconButton";

/**
 * IconButton covers ghost/secondary variants at both square densities, the
 * disabled state, and a realistic toolbar row composed with Button.
 * Backgrounds come from the "Theme" toolbar — stories never set their own.
 */
const meta = {
  title: "Durin DS/Actions/IconButton",
  component: IconButton,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  argTypes: {
    variant: { control: "inline-radio", options: ["ghost", "secondary"] },
    size: { control: "inline-radio", options: ["sm", "md"] },
    icon: { control: "text" },
  },
  args: {
    icon: "more_vert",
    label: "More actions",
  },
};

export default meta;

export const Ghost = {
  args: { variant: "ghost" },
};

export const Secondary = {
  args: { variant: "secondary" },
};

/** md = 32px square, sm = 26px square, in both variants. */
export const Sizes = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton icon="edit" label="Edit (medium ghost)" />
      <IconButton icon="edit" label="Edit (small ghost)" size="sm" />
      <IconButton icon="edit" label="Edit (medium secondary)" variant="secondary" />
      <IconButton
        icon="edit"
        label="Edit (small secondary)"
        variant="secondary"
        size="sm"
      />
    </div>
  ),
};

export const Disabled = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton icon="refresh" label="Refresh (disabled)" disabled />
      <IconButton
        icon="refresh"
        label="Refresh (disabled)"
        variant="secondary"
        disabled
      />
    </div>
  ),
};

/** Both variants across both densities plus disabled. */
export const VariantMatrix = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="w-20 text-xs text-dd-muted">ghost</span>
        <IconButton icon="settings" label="Settings (medium ghost)" />
        <IconButton icon="settings" label="Settings (small ghost)" size="sm" />
        <IconButton icon="settings" label="Settings (disabled)" disabled />
      </div>
      <div className="flex items-center gap-3">
        <span className="w-20 text-xs text-dd-muted">secondary</span>
        <IconButton icon="settings" label="Settings (medium secondary)" variant="secondary" />
        <IconButton
          icon="settings"
          label="Settings (small secondary)"
          variant="secondary"
          size="sm"
        />
        <IconButton
          icon="settings"
          label="Settings (disabled)"
          variant="secondary"
          disabled
        />
      </div>
    </div>
  ),
};

/** Realistic toolbar: navigation, title, filters, divider, and actions. */
export const ToolbarRow = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex w-full max-w-2xl items-center gap-1 rounded-dd-lg border border-dd-border bg-dd-surface px-2 py-1.5">
      <IconButton icon="arrow_back" label="Back" size="sm" />
      <span className="px-1.5 text-[13px] font-medium text-dd-text">
        Connections
      </span>
      <div className="flex-1" />
      <IconButton icon="search" label="Search connections" size="sm" />
      <IconButton icon="filter_list" label="Filter connections" size="sm" />
      <div aria-hidden="true" className="mx-1 h-5 w-px bg-dd-border" />
      <Button variant="ghost" size="sm" icon="download">
        Export
      </Button>
      <Button variant="primary" size="sm" icon="add">
        New connection
      </Button>
    </div>
  ),
};
