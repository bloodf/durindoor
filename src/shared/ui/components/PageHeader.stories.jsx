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
