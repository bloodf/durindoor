import { expect, userEvent, waitFor, within } from "storybook/test";
import TokenSaverDashboard from "../dashboards/TokenSaverDashboard.jsx";
import { SAVER_WIDGETS } from "../dashboards/model.js";
import { Settings } from "@/app/(dashboard)/dashboard/token-saver/TokenSaverClient.stories.jsx";
import pxpipeMeta, { Empty as PxpipeEmpty, Unavailable as PxpipeUnavailable } from "@/app/(dashboard)/dashboard/pxpipe/PxpipeClient.stories.jsx";
import { Metrics, EmptyWithDiagnostic } from "@/app/(dashboard)/dashboard/token-saver/components/TokenSaverOverview.stories.jsx";

// Reuse the incumbent aggregate, five PXPIPE windows, history and both log
// contracts so the default client renders its complete embedded overview.
export const saverRoutes = {
  ...Settings.parameters.storyFixture.routes,
  ...pxpipeMeta.parameters.storyFixture.routes,
  ...Metrics.parameters.storyFixture.routes,
  "GET /api/pxpipe/logs?limit=200": Settings.parameters.storyFixture.routes["GET /api/pxpipe/logs"],
};
const emptyStats = {
  requestsObserved: 0,
  rtk: { bytesSaved: 0, requestsWithHits: 0, hits: 0 },
  headroom: { tokensSaved: 0, compressed: 0, skipped: 0, phantomSavings: 0, bodyBytesBefore: 0, bodyBytesAfter: 0, skipReasons: {} },
  pxpipe: { tokensSavedEst: 0, applied: 0, imageCount: 0 },
  totals: { actualBytesSaved: 0 },
  dailyPoints: [],
};
const emptyRoutes = {
  ...saverRoutes,
  ...PxpipeEmpty.parameters.storyFixture.routes,
  "GET /api/token-saver/stream": { body: emptyStats, events: [emptyStats] },
  "GET /api/pxpipe/logs?limit=200": { body: { events: [] } },
};
const meta = {
  title: "Token saver overview", excludeStories: ["saverRoutes"],
  component: TokenSaverDashboard,
  args: { persistLayout: false },
  parameters: {
    layout: "fullscreen",
    reviewRoute: "/dashboard/token-saver",
    storyFixture: { scenario: "default", pathname: "/dashboard/token-saver", routes: saverRoutes },
  },
};
export default meta;

/** Actual aggregate and PXPIPE contracts now compose independent editable widgets. */
export const Overview = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("1.7 MB")).toBeVisible());
    await expect(await canvas.findByRole("region", { name: "PXPIPE status" })).toBeVisible();
    await expect(await canvas.findByRole("table", { name: "PXPIPE compression history" })).toBeVisible();
    await waitFor(() => expect(canvas.getByRole("region", { name: "PXPIPE transform events", exact: true })).toHaveTextContent("compressed 2 img, ~5.0K tokens saved in 220ms"));
    await userEvent.click(canvas.getByRole("radio", { name: "7D", exact: true }));
    await expect(canvas.getByRole("radio", { name: "7D", exact: true })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(canvas.getByRole("radio", { name: "7 days", exact: true }));
    await expect(canvas.getByRole("radio", { name: "7 days", exact: true })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(canvas.getAllByRole("button", { name: "Next page" })[0]);
    await expect(canvas.getAllByRole("button", { name: "Page 2" })[0]).toHaveAttribute("aria-current", "page");
    const refresh = canvas.getByRole("button", { name: "Refresh PXPIPE status", exact: true });
    await waitFor(() => expect(refresh).toBeEnabled());
    await userEvent.click(refresh);
    await waitFor(() => expect(refresh).toBeEnabled());
    await expect(canvas.queryByRole("button", { name: "Manage", exact: true })).not.toBeInTheDocument();
  },
};

export const Empty = {
  parameters: { storyFixture: { scenario: "empty", routes: emptyRoutes } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await within(canvas.getByRole("region", { name: "Compression overview" })).findByText("No Token Saver events yet")).toBeVisible();
    await expect(await canvas.findByText("No PXPIPE activity yet")).toBeVisible();
    await expect(await canvas.findByText("No transform events yet.")).toBeVisible();
  },
};

export const ServiceUnavailable = {
  parameters: {
    storyFixture: {
      scenario: "error",
      routes: {
        ...emptyRoutes,
        ...PxpipeUnavailable.parameters.storyFixture.routes,
        "GET /api/headroom/status": EmptyWithDiagnostic.parameters.storyFixture.routes["GET /api/headroom/status"],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Headroom setup needed")).toBeVisible();
    await expect(await canvas.findByText("PXPIPE daemon is not reachable")).toBeVisible();
    await expect(await within(canvas.getByRole("region", { name: "Compression overview" })).findByText("No Token Saver events yet")).toBeVisible();
    await expect(await canvas.findByText("No PXPIPE activity yet")).toBeVisible();
  },
};

export const EditSaveAndCancel = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("1.7 MB")).toBeVisible();
    for (const widget of SAVER_WIDGETS) await expect(canvas.getByRole("region", { name: widget.title })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Customize dashboard" }));
    await userEvent.click(canvas.getByRole("button", { name: "Edit Actual bytes saved" }));
    const dialog = within(within(document.body).getByRole("dialog", { name: "Edit widget" }));
    await userEvent.clear(dialog.getByLabelText("Widget name"));
    await userEvent.type(dialog.getByLabelText("Widget name"), "My byte savings");
    await userEvent.click(dialog.getByRole("combobox", { name: "Widget width" }));
    await userEvent.click(within(document.body).getByRole("option", { name: "Full width" }));
    await userEvent.click(dialog.getByRole("button", { name: "Apply changes" }));
    await userEvent.click(canvas.getByRole("button", { name: "Move My byte savings earlier" }));
    await userEvent.click(canvas.getByRole("button", { name: "Hide Headroom skip reasons" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save layout" }));
    await expect(canvasElement.querySelector("[data-widget-id]")).toHaveAttribute("data-widget-id", "saver-bytes");
    await expect(canvas.getByRole("region", { name: "My byte savings" })).toHaveAttribute("data-span", "12");
    await expect(canvas.queryByRole("region", { name: "Headroom skip reasons" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Customize dashboard" }));
    await userEvent.click(canvas.getByRole("button", { name: "Reset layout" }));
    await userEvent.click(canvas.getByRole("button", { name: "Cancel layout changes" }));
    await expect(canvas.getByRole("region", { name: "My byte savings" })).toBeVisible();
  },
};
export const AllWidgetsHidden = {
  args: { initialLayout: SAVER_WIDGETS.map((widget) => ({ ...widget, visible: false })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No dashboard widgets are visible. Choose widgets to begin.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Choose widgets" }));
    const library = within(within(document.body).getByRole("dialog", { name: "Widget library" }));
    await userEvent.click(library.getByRole("switch", { name: "Compression overview" }));
    await userEvent.click(library.getByRole("button", { name: "Done" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save layout" }));
    await expect(await canvas.findByText("1.7 MB")).toBeVisible();
  },
};
export const MissingSavedSource = {
  args: { initialLayout: [{ id: "retired-transform", title: "Retired transform", span: 6, visible: true }, ...SAVER_WIDGETS.map((widget) => ({ ...widget, visible: false }))] },
  play: async ({ canvasElement }) => { await expect(within(canvasElement).getByText("This widget source is unavailable. Choose a replacement from the widget library.")).toBeVisible(); },
};
export const LoadingMetrics = {
  parameters: { storyFixture: { routes: { "GET /api/token-saver/stream": { body: {}, events: [] } } } },
  play: async ({ canvasElement }) => { await expect(within(canvasElement).getAllByText("Loading Token Saver metrics")[0]).toBeVisible(); },
};
