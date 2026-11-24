import React from "react";
import { expect, userEvent, within } from "storybook/test";
import AutoConfigureClient from "./AutoConfigureClient.js";

const status = {
  wouldChange: true,
  services: {
    headroom: { running: true, installed: true, wouldChange: false, actions: ["Headroom is already running"] },
    firecrawl: { installed: false, wouldChange: true, actions: ["$ npm install firecrawl"] },
    pxpipe: { running: false, installed: false, wouldChange: true, actions: ["$ headroomUrl=http://localhost:8080 pip install pxpipe"] },
    toggles: { installed: true, wouldChange: false, actions: [] },
  },
  actions: ["$ npm install firecrawl", "$ headroomUrl=http://localhost:8080 pip install pxpipe"],
};
const plainTextStatus = {
  wouldChange: false,
  services: {
    headroom: { running: true, installed: true, wouldChange: false, actions: ["Headroom is already running"] },
    pxpipe: { running: false, installed: false, wouldChange: false, actions: ["pxpipe-proxy dependency not detected; skipping enable"] },
    firecrawl: { detected: true, running: true, wouldChange: false, actions: ["firecrawl custom connection already up to date"] },
    toggles: { installed: true, wouldChange: false, actions: ["rtkEnabled already true"] },
  },
  actions: [
    "Headroom is already running",
    "pxpipe-proxy dependency not detected; skipping enable",
    "firecrawl custom connection already up to date",
    "rtkEnabled already true",
  ],
};
const headroomDiagnostic = {
  diagnostic: {
    code: "NOT_INSTALLED",
    summary: "Headroom binary was not found in the managed environment.",
    detail: "Install Headroom with compression extras before enabling the local proxy.",
    fixes: [
      {
        label: "Install Headroom into the managed environment",
        command: "uv tool install headroom-ai[proxy,code,ml]",
        url: "https://headroom.example/docs/install",
      },
    ],
  },
};
const pxpipeDiagnostic = {
  code: "VENV_TOOLS_MISSING",
  summary: "PxPipe helper environment is missing required tools.",
  detail: "Recreate the helper environment and retry configuration.",
  fixes: [
    {
      label: "Open setup troubleshooting",
      url: "https://pxpipe.example/docs/setup",
    },
  ],
};
const diagnosticStatus = {
  wouldChange: true,
  services: {
    headroom: { running: false, installed: false, wouldChange: true, actions: ["headroom not reachable; would install then enable"] },
    pxpipe: { running: false, installed: false, wouldChange: false, actions: ["pxpipe-proxy dependency not detected; skipping enable"] },
    firecrawl: { detected: true, running: true, wouldChange: false, actions: ["firecrawl custom connection already up to date"] },
    toggles: { installed: true, wouldChange: false, actions: [] },
  },
  actions: [headroomDiagnostic, pxpipeDiagnostic],
};
const runReport = { report: { dryRun: true, wouldChange: true, services: status.services, actions: status.actions } };

function serviceRow(scope, label) {
  return scope.getByText(label).closest("[class~='flex'][class~='flex-col'][class~='gap-2']");
}

const meta = {
  title: "Durin DS/Production Pages/auto-configure",
  component: AutoConfigureClient,
  args: { status },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/auto-configure", routes: { "POST /api/settings/auto-configure": { body: runReport } } } },
};
export default meta;

export const StatusPreview = {
  name: "Status preview",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Auto-configure", level: 1 })).toBeVisible();
    const statusCard = await canvas.findByRole("heading", { name: "Status", level: 2 });
    await expect(statusCard).toBeVisible();
    const summary = within(statusCard.parentElement.parentElement);
    await expect(summary.getByText("Headroom")).toBeVisible();
    await expect(summary.getByText("PxPipe")).toBeVisible();
    await expect(summary.getByText("Firecrawl")).toBeVisible();
    await expect(summary.getByText("Toggles")).toBeVisible();
    await expect((await summary.findAllByText("Up to date")).length).toBeGreaterThanOrEqual(2);
    await expect((await summary.findAllByText("Unavailable")).length).toBeGreaterThanOrEqual(2);
    const previewBadge = await summary.findByText("Preview — would apply changes");
    await expect(previewBadge).toBeVisible();
    const headroomRow = serviceRow(summary, "Headroom");
    await expect(within(headroomRow).getByText("Headroom is already running")).toBeVisible();
    await expect(within(headroomRow).queryByRole("region", { name: "Configuration command" })).toBeNull();
    await expect(within(headroomRow).queryByRole("button", { name: "Copy" })).toBeNull();
    const details = summary.getByText("Action log (2)");
    await userEvent.click(details);
    const firecrawlRow = serviceRow(summary, "Firecrawl");
    await expect(within(firecrawlRow).getByText("$ npm install firecrawl")).toBeVisible();
    await expect(within(firecrawlRow).getByRole("region", { name: "Configuration command" })).toHaveTextContent("$ npm install firecrawl");
    await expect(within(firecrawlRow).getByRole("button", { name: "Copy" })).toBeVisible();
    const pxpipeRow = serviceRow(summary, "PxPipe");
    await expect(within(pxpipeRow).getByText("$ headroomUrl=http://localhost:8080 pip install pxpipe")).toBeVisible();
    await expect(within(pxpipeRow).getByRole("region", { name: "Configuration command" })).toHaveTextContent("$ headroomUrl=http://localhost:8080 pip install pxpipe");
    await expect(within(pxpipeRow).getByRole("button", { name: "Copy" })).toBeVisible();
    const actionLog = within(details.closest("details"));
    await expect(actionLog.getAllByRole("region", { name: "Configuration command" })).toHaveLength(2);
  },
};

export const PlainTextActions = {
  name: "Plain text actions",
  args: { status: plainTextStatus },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const statusCard = await canvas.findByRole("heading", { name: "Status", level: 2 });
    await expect(statusCard).toBeVisible();
    const summary = within(statusCard.parentElement.parentElement);
    await expect(await summary.findByText("Preview — nothing to change")).toBeVisible();
    await expect(within(serviceRow(summary, "Headroom")).getByText("Headroom is already running")).toBeVisible();
    await expect(within(serviceRow(summary, "PxPipe")).getByText("pxpipe-proxy dependency not detected; skipping enable")).toBeVisible();
    await expect(within(serviceRow(summary, "Firecrawl")).getByText("firecrawl custom connection already up to date")).toBeVisible();
    await expect(within(serviceRow(summary, "Toggles")).getByText("rtkEnabled already true")).toBeVisible();
    const details = summary.getByText("Action log (4)");
    await userEvent.click(details);
    const actionLog = within(details.closest("details"));
    await expect(actionLog.getByText("pxpipe-proxy dependency not detected; skipping enable")).toBeVisible();
    await expect(actionLog.getByText("rtkEnabled already true")).toBeVisible();
    await expect(summary.queryByRole("region", { name: "Configuration command" })).toBeNull();
    await expect(summary.queryByRole("button", { name: "Copy" })).toBeNull();
    await expect(summary.queryByRole("alert")).toBeNull();
  },
};

export const DiagnosticActions = {
  name: "Diagnostic actions",
  args: { status: diagnosticStatus },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const statusCard = await canvas.findByRole("heading", { name: "Status", level: 2 });
    await expect(statusCard).toBeVisible();
    const summary = within(statusCard.parentElement.parentElement);
    await expect(within(serviceRow(summary, "Headroom")).getByText("headroom not reachable; would install then enable")).toBeVisible();
    await expect(within(serviceRow(summary, "Firecrawl")).getByText("firecrawl custom connection already up to date")).toBeVisible();
    const details = summary.getByText("Action log (2)");
    await userEvent.click(details);
    const alerts = within(details.closest("details")).getAllByRole("alert");
    await expect(alerts).toHaveLength(2);
    const [headroomAlert, pxpipeAlert] = alerts;
    await expect(headroomAlert).toBeVisible();
    await expect(within(headroomAlert).getByText("Headroom is not installed")).toBeVisible();
    await expect(within(headroomAlert).getByText("Headroom binary was not found in the managed environment.")).toBeVisible();
    await expect(within(headroomAlert).getByText("uv tool install headroom-ai[proxy,code,ml]")).toBeVisible();
    await expect(within(headroomAlert).getByRole("button", { name: "Copy" })).toBeVisible();
    await expect(within(headroomAlert).getByRole("link", { name: "Open fix link" })).toHaveAttribute("href", "https://headroom.example/docs/install");
    await expect(pxpipeAlert).toBeVisible();
    await expect(within(pxpipeAlert).getByText("Managed virtualenv is missing required tools")).toBeVisible();
    await expect(within(pxpipeAlert).getByText("PxPipe helper environment is missing required tools.")).toBeVisible();
    await expect(within(pxpipeAlert).getByRole("link", { name: "Open fix link" })).toHaveAttribute("href", "https://pxpipe.example/docs/setup");
  },
};

export const RunSuccess = {
  name: "Run success",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const run = await canvas.findByRole("button", { name: /Run auto-configure/ });
    await userEvent.click(run);
    const resultHeading = await canvas.findByRole("heading", { name: "Dry run result", level: 2 });
    await expect(resultHeading).toBeVisible();
    await expect(canvas.queryByRole("heading", { name: "Status", level: 2 })).toBeNull();
    const summary = within(resultHeading.parentElement.parentElement);
    await expect(summary.getByText("Headroom")).toBeVisible();
    await expect(summary.getByText("Firecrawl")).toBeVisible();
    const headroomRow = serviceRow(summary, "Headroom");
    await expect(within(headroomRow).getByText("Headroom is already running")).toBeVisible();
    await expect(within(headroomRow).queryByRole("region", { name: "Configuration command" })).toBeNull();
    const firecrawlRow = serviceRow(summary, "Firecrawl");
    await expect(within(firecrawlRow).getByRole("region", { name: "Configuration command" })).toHaveTextContent("$ npm install firecrawl");
    await expect(within(firecrawlRow).getByRole("button", { name: "Copy" })).toBeVisible();
    const details = summary.getByText("Action log (2)");
    await userEvent.click(details);
    await expect(within(details.closest("details")).getAllByRole("region", { name: "Configuration command" })).toHaveLength(2);
  },
};

export const RunFailure = {
  name: "Run failure",
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/auto-configure", routes: { "POST /api/settings/auto-configure": { status: 500, body: { error: "Configuration service unavailable" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const run = await canvas.findByRole("button", { name: /Run auto-configure/ });
    await userEvent.click(run);
    await expect(await canvas.findByText("Configuration service unavailable")).toBeVisible();
  },
};

export const StatusLoadRecovery = {
  args: { status: null, initialError: "Configuration status could not be loaded." },
  parameters: { storyFixture: { routes: { "GET /api/settings/auto-configure": { body: status } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Configuration status could not be loaded");
    await userEvent.click(canvas.getByRole("button", { name: "Retry status" }));
    await expect(await canvas.findByRole("heading", { name: "Status", level: 2 })).toBeVisible();
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};
