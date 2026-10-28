import { expect, userEvent, waitFor, within } from "storybook/test";
import WorkspacesPage from "./WorkspacesPage.jsx";
import { normalizeDashboardLayout, WORKSPACE_WIDGETS } from "./model.js";
import { usageFixture } from "../usage/fixtures.js";
import { saverRoutes } from "../routes/SaverOverview.stories.jsx";
import monitoringMeta from "../routes/Monitoring.stories.jsx";
import quotaMeta from "@/app/(dashboard)/dashboard/quota/page.stories.jsx";

const routes = {
  ...quotaMeta.parameters.storyFixture.routes,
  ...usageFixture.routes,
  ...saverRoutes,
  ...monitoringMeta.parameters.storyFixture.routes,
};
const meta = { title: "Your dashboards", component: WorkspacesPage, args: { persistLayout: false }, parameters: { layout: "fullscreen", reviewRoute: "/dashboard/workspaces", storyFixture: { scenario: "default", pathname: "/dashboard/workspaces", routes } } };
export default meta;
export const Operations = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Total requests")).toBeVisible();
    await expect(await canvas.findByText("146 MB")).toBeVisible();
    await expect(canvas.getByRole("combobox", { name: "Active dashboard" })).toHaveTextContent("Operations");
  },
};
export const CreateAndComposeDashboard = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "New dashboard", exact: true }));
    const create = within(within(document.body).getByRole("dialog", { name: "New dashboard" }));
    await expect(create.getByRole("button", { name: "Create dashboard" })).toBeDisabled();
    await userEvent.type(create.getByLabelText("Dashboard name"), "Team overview");
    await userEvent.click(create.getByRole("button", { name: "Create dashboard" }));
    await expect(canvas.getByRole("combobox", { name: "Active dashboard" })).toHaveTextContent("Team overview");
    await expect(canvas.getByText("No dashboard widgets are visible. Choose widgets to begin.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Choose widgets" }));
    const library = within(within(document.body).getByRole("dialog", { name: "Widget library" }));
    for (const name of ["Usage overview", "Actual bytes saved", "Provider quota", "Gateway monitoring"]) await userEvent.click(library.getByRole("switch", { name, exact: true }));
    await userEvent.click(library.getByRole("button", { name: "Done" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save layout" }));
    await expect(await canvas.findByText("Total requests")).toBeVisible();
    await expect(await canvas.findByText("146 MB")).toBeVisible();
    await expect(await canvas.findByText(/No Providers Connected/i)).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Actual bytes saved", exact: true })).toBeVisible();
    await userEvent.click(canvas.getByRole("combobox", { name: "Active dashboard" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "Operations", exact: true }));
    await expect(canvas.queryByRole("region", { name: "Actual bytes saved", exact: true })).toBeNull();
    await userEvent.click(canvas.getByRole("combobox", { name: "Active dashboard" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "Team overview", exact: true }));
    await expect(canvas.getByRole("region", { name: "Actual bytes saved", exact: true })).toBeVisible();
  },
};
export const RenameAndDeleteDashboard = {
  args: { initialWorkspaces: { activeId: "second", dashboards: [{ id: "operations", name: "Operations", layout: null }, { id: "second", name: "Daily review", layout: null }] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Rename dashboard" }));
    const rename = within(within(document.body).getByRole("dialog", { name: "Rename dashboard" }));
    await userEvent.clear(rename.getByLabelText("Dashboard name"));
    await userEvent.type(rename.getByLabelText("Dashboard name"), "Production health");
    await userEvent.click(rename.getByRole("button", { name: "Save name" }));
    await expect(canvas.getByRole("combobox", { name: "Active dashboard" })).toHaveTextContent("Production health");
    await userEvent.click(canvas.getByRole("button", { name: "Delete dashboard" }));
    await userEvent.click(within(within(document.body).getByRole("dialog", { name: "Delete dashboard" })).getByRole("button", { name: "Keep dashboard" }));
    await expect(canvas.getByRole("combobox", { name: "Active dashboard" })).toHaveTextContent("Production health");
    await userEvent.click(canvas.getByRole("button", { name: "Delete dashboard" }));
    await userEvent.click(within(within(document.body).getByRole("dialog", { name: "Delete dashboard" })).getByRole("button", { name: "Delete dashboard" }));
    await expect(canvas.getByRole("combobox", { name: "Active dashboard" })).toHaveTextContent("Operations");
    await expect(canvas.getByRole("button", { name: "Delete dashboard" })).toBeDisabled();
  },
};
export const EmptyDashboard = {
  args: { initialWorkspaces: { activeId: "empty", dashboards: [{ id: "empty", name: "Blank canvas", layout: WORKSPACE_WIDGETS.map((widget) => ({ ...widget, visible: false })) }] } },
  play: async ({ canvasElement }) => { await expect(within(canvasElement).getByText("No dashboard widgets are visible. Choose widgets to begin.")).toBeVisible(); },
};
export const MissingSource = {
  args: { initialWorkspaces: { activeId: "legacy", dashboards: [{ id: "legacy", name: "Imported dashboard", layout: normalizeDashboardLayout([{ id: "retired-source", title: "Retired source", span: 12, visible: true }, ...WORKSPACE_WIDGETS.map((widget) => ({ ...widget, visible: false }))], WORKSPACE_WIDGETS) }] } },
  play: async ({ canvasElement }) => { await expect(within(canvasElement).getByText("This widget source is unavailable. Choose a replacement from the widget library.")).toBeVisible(); },
};
export const MonitoringUnavailable = { parameters: { storyFixture: { routes: { "GET /api/monitoring": { status: 503, body: { error: "Unavailable" } } } } }, play: async ({ canvasElement }) => { await expect(await within(canvasElement).findByText(/HTTP 503/)).toBeVisible(); } };

let monitoringReads = 0;
export const MonitoringRefreshAndPause = {
  beforeEach: () => { monitoringReads = 0; return () => { monitoringReads = 0; }; },
  parameters: { storyFixture: { routes: { "GET /api/monitoring": () => { const current = monitoringMeta.parameters.storyFixture.routes["GET /api/monitoring"].body; monitoringReads++; return { body: { ...current, runtime: { ...current.runtime, memoryRssMB: monitoringReads === 1 ? 146 : 198 } } }; } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const monitor = within(canvas.getByRole("region", { name: "Gateway monitoring" }));
    await expect(await monitor.findByText("146 MB")).toBeVisible();
    await userEvent.click(monitor.getByRole("button", { name: "Live", exact: true }));
    await expect(monitor.getByRole("button", { name: "Paused", exact: true })).toHaveAttribute("aria-pressed", "false");
    const refresh = monitor.getByRole("button", { name: "Refresh monitoring" });
    await waitFor(() => expect(refresh).toBeEnabled());
    await userEvent.click(refresh);
    await expect(await monitor.findByText("198 MB")).toBeVisible();
  },
};
