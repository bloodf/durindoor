import React from "react";
import { expect, userEvent, within } from "storybook/test";
import CompressionStudioPage from "./page.js";

const providers = { connections: [] };
const previewSuccess = { engines: ["rtk", "headroom"], results: { rtk: { compressed: true, savingsPercent: 45.25, raw: { model: "openai/gpt-4o", messages: [] } }, headroom: { compressed: false, savingsPercent: 0, raw: null } } };
const previewUnavailable = { engines: ["rtk", "caveman"], results: { rtk: { compressed: true, savingsPercent: 12, raw: "ok" }, caveman: { status: "unavailable" } } };
const meta = {
  title: "Durin DS/Production Pages/compression-studio",
  component: CompressionStudioPage,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/compression-studio", routes: { "GET /api/providers": { body: providers }, "POST /api/compression/preview": { body: previewSuccess } } } },
};
export default meta;

export const Empty = {
  name: "Empty",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Test Savers", level: 1 })).toBeVisible();
    await expect(canvas.getByText("No preview yet")).toBeVisible();
    await expect(canvas.getByLabelText("Engine")).toBeVisible();
    await expect(canvas.getByLabelText("Example preset")).toBeVisible();
  },
};

export const PreviewResult = {
  name: "Preview result",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const model = await canvas.findByLabelText("Model");
    await userEvent.type(model, "openai/gpt-4o");
    const textarea = canvas.getByLabelText("Input text");
    await userEvent.type(textarea, "hello world");
    const run = canvas.getByRole("button", { name: "Run preview" });
    await userEvent.click(run);
    const resultsHeading = await canvas.findByRole("heading", { name: "Results", level: 2 });
    await expect(resultsHeading).toBeVisible();
    await expect(canvas.getByText("45.25%")).toBeVisible();
    const showRaw = await canvas.findByRole("button", { name: "Show raw JSON" });
    await userEvent.click(showRaw);
    const rawRegion = await canvas.findByRole("region", { name: "rtk raw output" });
    await expect(rawRegion).toBeVisible();
    await expect(within(rawRegion).getByText(/"model": "openai\/gpt-4o"/)).toBeVisible();
  },
};

export const UnavailableEngine = {
  name: "Unavailable engine",
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/compression-studio", routes: { "GET /api/providers": { body: providers }, "POST /api/compression/preview": { body: previewUnavailable } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText("Model"), "openai/gpt-4o");
    await userEvent.click(canvas.getByRole("button", { name: "Run preview" }));
    await expect(await canvas.findByText("unavailable")).toBeVisible();
  },
};

export const PreviewFailure = {
  name: "Preview failure",
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/compression-studio", routes: { "GET /api/providers": { body: providers }, "POST /api/compression/preview": { status: 400, body: { error: { message: "Unsupported request" } } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText("Model"), "openai/gpt-4o");
    await userEvent.click(canvas.getByRole("button", { name: "Run preview" }));
    await expect(await canvas.findByText("Unsupported request")).toBeVisible();
  },
};
