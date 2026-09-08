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
const runReport = { report: { dryRun: true, wouldChange: true, services: status.services, actions: status.actions } };
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
    await expect(canvas.getByText("Headroom")).toBeVisible();
    await expect(canvas.getByText("PxPipe")).toBeVisible();
    await expect(canvas.getByText("Firecrawl")).toBeVisible();
    await expect(canvas.getByText("Toggles")).toBeVisible();
    await expect((await canvas.findAllByText("Up to date")).length).toBeGreaterThanOrEqual(2);
    await expect((await canvas.findAllByText("Unavailable")).length).toBeGreaterThanOrEqual(2);
    const previewBadge = await canvas.findByText("Preview — would apply changes");
    await expect(previewBadge).toBeVisible();
    const details = canvas.getByText("Action log (2)");
    await userEvent.click(details);
    const firecrawl = canvas.getByText("Firecrawl");
    const firecrawlRow = firecrawl.closest("[class~='flex'][class~='flex-col'][class~='gap-2']");
    await expect(within(firecrawlRow).getByText("$ npm install firecrawl")).toBeVisible();
    const pxpipe = canvas.getByText("PxPipe");
    const pxpipeRow = pxpipe.closest("[class~='flex'][class~='flex-col'][class~='gap-2']");
    await expect(within(pxpipeRow).getByText("$ headroomUrl=http://localhost:8080 pip install pxpipe")).toBeVisible();
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
    await expect(canvas.getByText("Headroom")).toBeVisible();
    await expect(canvas.getByText("Firecrawl")).toBeVisible();
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
