import React, { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Sidebar from "./Sidebar";

/** The review frame and the production `data-ui="v5"` switch both relabel Token Saver "Statistics" as "Dashboard". */
const usesV5Labels = () => document.documentElement.dataset.v5Review === "true" || document.documentElement.dataset.ui === "v5";

/** V5 shows icon tooltips only for pointers over the icon, so hover the icon when the switch is on. */
const tooltipTarget = (control) => (document.documentElement.dataset.ui === "v5" && control.querySelector(".material-symbols-outlined, .v5-motion-icon, svg")) || control;

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

/** Opening the Token Saver group exposes its routes; the update action opens its dialog. */
export const GroupsAndUpdate = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole("button", { name: "Token Saver" });
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(group);
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(canvas.getByText(usesV5Labels() ? "Dashboard" : "Statistics")).toBeVisible());
    // The version check fires 2.5s after mount, longer than the default findBy timeout.
    await userEvent.click(await canvas.findByRole("button", { name: "Update now" }, { timeout: 6000 }));
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

export const TokenSaverActiveHierarchy = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/token-saver",
      routes: {
        "GET /api/settings": { body: {} },
        "GET /api/version": { body: {} },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const parent = canvas.getByRole("button", { name: "Token Saver" });
    const statistics = canvas.getByRole("link", { name: usesV5Labels() ? "Dashboard" : "Statistics" });
    await expect(parent).toHaveAttribute("aria-expanded", "true");
    await expect(parent).not.toHaveAttribute("aria-current");
    await expect(statistics).toHaveAttribute("aria-current", "page");
    const optimize = within(canvas.getByRole("group", { name: "Optimize" }));
    await expect(optimize.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
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
    await userEvent.hover(tooltipTarget(canvas.getByRole("button", { name: "Expand sidebar" })));
    await waitFor(() => expect(within(document.body).getByRole("tooltip")).toHaveTextContent("Expand sidebar"));
    await userEvent.click(canvas.getByRole("button", { name: "Expand sidebar" }));
    await waitFor(() => expect(canvas.getByRole("link", { name: "Usage" })).toBeVisible());
  },
};

function InitiallyCollapsedSidebar() {
  const [collapsed, setCollapsed] = useState(true);
  return <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((value) => !value)} />;
}

/** Leaves collapsed private tooltip visible after real pointer interaction. */
export const CollapsedTooltip = {
  render: () => <InitiallyCollapsedSidebar />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole("button", { name: "Expand sidebar" });
    await userEvent.hover(tooltipTarget(control));
    await waitFor(() => expect(within(document.body).getByRole("tooltip")).toHaveTextContent("Expand sidebar"));
  },
};
