import Button from "./Button";
import PageHeader from "./PageHeader";

const meta = {
  title: "Durin DS/Data/PageHeader",
  component: PageHeader,
  parameters: { layout: "padded" },
};

export default meta;

/** Title, supporting context, and icon tile for a data page. */
export const BaseHeader = {
  args: {
    icon: "database",
    title: "Model catalog",
    subtitle: "12 configured models across 3 providers",
  },
};

/** Realistic secondary and primary actions passed through PageHeader's actions slot. */
export const WithActions = {
  args: {
    icon: "hub",
    title: "Provider connections",
    subtitle: "Manage credentials and routing for connected providers",
    actions: (
      <>
        <Button variant="secondary" icon="tune">
          Configure
        </Button>
        <Button variant="primary" icon="add">
          Add provider
        </Button>
      </>
    ),
  },
};

/** Long identity text and multiple 44px actions wrap without clipping at mobile width. */
export const NarrowWithLongContent = {
  render: (args) => (
    <div className="w-72 min-w-0 max-w-full">
      <PageHeader {...args} />
    </div>
  ),
  args: {
    icon: "database",
    title: "Production provider configuration with uninterrupted-routing-identifier",
    subtitle: "Credentials, regional routing, and fallback behavior for a-long-unbroken-provider-reference-that-must-wrap",
    actions: (
      <>
        <Button variant="secondary" icon="tune">
          Configure routing
        </Button>
        <Button variant="primary" icon="add">
          Add provider
        </Button>
      </>
    ),
  },
};
