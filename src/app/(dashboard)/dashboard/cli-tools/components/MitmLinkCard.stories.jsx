import React from "react";
import { within, expect } from "storybook/test";
import MitmLinkCard from "./MitmLinkCard";
import { MITM_TOOLS } from "@/shared/constants/cliTools";
export default {
  title: "Durin DS/Production Pages/cli-tools/MitmLinkCard",
  component: MitmLinkCard,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools" } },
};

export const AntigravityMitm = {
  args: { tool: MITM_TOOLS.antigravity },
  play: ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link");
    expect(within(link).getByRole("heading", { name: MITM_TOOLS.antigravity.name })).toBeInTheDocument();
    expect(within(link).getByText("MITM")).toBeInTheDocument();
    expect(within(link).getByText(MITM_TOOLS.antigravity.description)).toBeInTheDocument();
  },
};
