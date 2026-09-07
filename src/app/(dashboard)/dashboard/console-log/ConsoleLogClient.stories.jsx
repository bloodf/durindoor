import React from "react";
import { expect, userEvent, within } from "storybook/test";
import ConsoleLogClient from "./ConsoleLogClient";

const routes = {
  "GET /api/translator/console-logs": { body: { success: true, logs: ["[INFO] Listening on port 3000", "[WARN] Queue depth high", "[ERROR] Provider timeout", "[DEBUG] cache miss"] } },
  "GET /api/translator/console-logs/stream": { events: [{ type: "init", logs: ["[INFO] Listening on port 3000", "[WARN] Queue depth high", "[ERROR] Provider timeout", "[DEBUG] cache miss"] }] },
  "DELETE /api/translator/console-logs": { body: { success: true } },
};

const emptyRoutes = {
  "GET /api/translator/console-logs": { body: { success: true, logs: [] } },
  "GET /api/translator/console-logs/stream": { events: [{ type: "init", logs: [] }] },
};

export default {
  title: "Production/operations/ConsoleLogClient",
  component: ConsoleLogClient,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/console-log", routes } },
};

export const Streaming = { parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/console-log", routes } } };
export const Empty = { parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/console-log", routes: emptyRoutes } } };
export const FilterPauseAndClear = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/console-log", routes } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const errorLine = await canvas.findByText("[ERROR] Provider timeout");
    // ConsoleLogClient's colorLine() wraps each source line in its level tone.
    await expect(errorLine).toHaveClass("text-dd-danger");
    await expect(canvas.getByText("[INFO] Listening on port 3000")).toHaveClass("text-dd-info");
    await userEvent.type(canvas.getByLabelText("Search console logs"), "timeout");
    await expect(canvas.getByText("[ERROR] Provider timeout")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("combobox", { name: "Filter by log level" }));
    await userEvent.click(await within(document.body).findByRole("option", { name: "ERROR" }));
    await userEvent.click(canvas.getByRole("button", { name: "Pause" }));
    await expect(canvas.getByText("Paused")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Clear" }));
    await expect(canvas.getByText("No console logs yet.")).toBeInTheDocument();
  }
};
