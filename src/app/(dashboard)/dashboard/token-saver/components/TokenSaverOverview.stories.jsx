import React from "react";
import { expect, userEvent, within } from "storybook/test";
import TokenSaverOverview from "./TokenSaverOverview";

const streamStats = {
  requestsObserved: 78,
  rtk: { bytesSaved: 1824760, requestsWithHits: 55, hits: 183 },
  headroom: {
    tokensSaved: 44820,
    compressed: 43,
    skipped: 11,
    phantomSavings: 2,
    bodyBytesBefore: 1247600,
    bodyBytesAfter: 926400,
    skipReasons: { disabled: 4, "unsupported request": 3, "unsafe input": 2 },
  },
  pxpipe: { tokensSavedEst: 18200, applied: 12, imageCount: 37 },
  totals: { actualBytesSaved: 2141200 },
  dailyPoints: [
    { dateKey: "2026-09-01", actualBytesSaved: 210040 },
    { dateKey: "2026-09-02", actualBytesSaved: 325820 },
    { dateKey: "2026-09-03", actualBytesSaved: 471210 },
    { dateKey: "2026-09-04", actualBytesSaved: 318400 },
  ],
};

const routes = {
  "GET /api/headroom/status": { body: { installed: true, running: true } },
  "GET /api/token-saver/stream": { body: streamStats, events: [streamStats] },
};

const meta = {
  title: "Production/savers/TokenSaverOverview",
  component: TokenSaverOverview,
  parameters: { layout: "fullscreen" },
};
export default meta;

/** Stream-fed metrics: period control, RTK/Headroom/PXPIPE/Actual-payload StatCards, skip-reason Badge list. */
export const Metrics = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/token-saver", params: {}, routes } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("RTK bytes saved")).toBeTruthy();
    await expect(await canvas.findByText("1.7 MB")).toBeTruthy();
    await userEvent.click(await canvas.findByRole("radio", { name: "7D" }));
    await expect(canvas.getByRole("radio", { name: "7D" })).toHaveAttribute("aria-checked", "true");
    await expect(await canvas.findByText("pxpipe image estimate")).toBeTruthy();
    await expect(await canvas.findByText("unsupported request")).toBeTruthy();
  },
};

/** Empty stream + Headroom NOT_INSTALLED diagnostic: EmptyState copy and SetupDiagnosticCard banner render. */
export const EmptyWithDiagnostic = {
  parameters: {
    storyFixture: {
      scenario: "error",
      pathname: "/dashboard/token-saver",
      params: {},
      routes: {
        "GET /api/headroom/status": {
          body: { ok: false, diagnostic: { code: "NOT_INSTALLED", summary: "Headroom setup needed", fixes: [] } },
        },
        "GET /api/token-saver/stream": {
          body: { requestsObserved: false },
          events: [{ requestsObserved: false }],
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Headroom setup needed")).toBeTruthy();
    await expect(await canvas.findByText("No Token Saver events yet")).toBeTruthy();
  },
};
