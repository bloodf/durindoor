import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import SkillsPage from "./SkillsPage.jsx";

const meta = {
  title: "Durin DS/Pages/Skills",
  component: SkillsPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/skills",
      title: "Agent Skills",
      subtitle: "Copy a link and paste to your AI to use DurinDoor — no install needed",
      icon: "extension",
    }),
  ],
};

export default meta;

/** Interactive composer with the local endpoint and Cortex API key selected. */
export const Default = {};

/** Composer with the custom endpoint input visible and ready to edit. */
export const CustomEndpoint = {
  args: {
    initialEndpoint: "custom",
    initialCustomEndpoint: "https://gateway.example.com/v1",
  },
};

/** Composer without authorization and with the keyless warning visible. */
export const NoKey = {
  args: {
    initialApiKey: "",
  },
};
