import React from "react";
import { expect, within } from "storybook/test";
import DocsLink from "./DocsLink";

export default { title: "Production/shared-navigation/DocsLink", component: DocsLink, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers" } } };

export const ExternalDocumentation = {
  args: { path: "/providers", label: "Provider documentation" },
  play: ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", { name: /provider documentation/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  },
};
