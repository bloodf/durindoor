import React, { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Sidebar from "./Sidebar";

const meta = {
  title: "Production/shell/Sidebar",
  component: Sidebar,
  parameters: {
    layout: "fullscreen",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/usage",
      routes: {
        "GET /api/settings": { body: { enableTranslator: true } },
        "GET /api/version": {
          body: { hasUpdate: true, currentVersion: "2.1.0", latestVersion: "2.2.0" },
        },
      },
    },
  },
};
export default meta;

/** Covers private provider/token/media groups, translator gate, and update overlay. */
export const GroupsAndUpdate = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Providers" }));
    await waitFor(() => expect(canvas.getByText("Configuration")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Token Saver" }));
    await waitFor(() => expect(canvas.getByText("Statistics")).toBeVisible());
    await userEvent.click(await canvas.findByRole("button", { name: "Update now" }));
    await waitFor(() => expect(within(document.body).getByRole("dialog", { name: "Update available" })).toBeVisible());
  },
};

export const MediaExpanded = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/embedding",
      routes: {
        "GET /api/settings": { body: {} },
        "GET /api/version": { body: {} },
      },
    },
  },
};

function ControlledCollapse() {
  const [collapsed, setCollapsed] = useState(false);
  return <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />;
}

/** Desktop collapse control: labels hide, icon-only rail persists reachable nav. */
export const CollapsibleRail = {
  render: () => <ControlledCollapse />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const usageLink = canvas.getByRole("link", { name: "Usage" });
    await waitFor(() => expect(usageLink).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Collapse sidebar" }));
    await waitFor(() => expect(canvas.getByRole("link", { name: "Usage" })).toBeVisible());
    await waitFor(() => expect(canvas.getByRole("button", { name: "Expand sidebar" })).toBeVisible());
    // Tooltip wrappers must not shrink links into a two-column icon grid.
    await waitFor(() => {
      const links = within(canvas.getByRole("navigation")).getAllByRole("link");
      const rects = links.map((link) => link.getBoundingClientRect());
      for (const [index, rect] of rects.entries()) {
        expect(rect.width).toBeGreaterThanOrEqual(44);
        expect(rect.height).toBeGreaterThanOrEqual(44);
        if (index) expect(rect.top).toBeGreaterThanOrEqual(rects[index - 1].bottom);
      }
    });
    await userEvent.hover(canvas.getByRole("button", { name: "Expand sidebar" }));
    await waitFor(() => expect(within(document.body).getByRole("tooltip")).toHaveTextContent("Expand sidebar"));
    await userEvent.click(canvas.getByRole("button", { name: "Expand sidebar" }));
    await waitFor(() => expect(canvas.getByRole("link", { name: "Usage" })).toBeVisible());
  },
};
