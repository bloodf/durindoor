import React from "react";
import { expect, userEvent, within } from "storybook/test";
import StartupConfiguration from "./StartupConfiguration.jsx";

const startupEnv = { exists: true, keys: { DURINDOOR_DATABASE_ENGINE: { source: "file" }, DURINDOOR_PG_URL: { source: "file" }, DURINDOOR_PG_SSLMODE: { source: "file" } }, effective: { engine: "postgres", host: "db.example.test", port: "5432", database: "durindoor", user: "operator", sslmode: "require" } };
const args = { startupEnv, password: "fixture", onUnauthorized: () => {}, onSaved: () => {} };

export default { title: "Production/settings/StartupConfiguration", component: StartupConfiguration, args, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/settings/database", routes: { "POST /api/settings/database/startup-env?test=1": { body: { ok: true, latencyMs: 22 } }, "POST /api/settings/database/startup-env": { body: { ok: true, restartRequired: true, startupEnv } }, "DELETE /api/settings/database/startup-env": { body: { ok: true } } } } } };

export const TestConnection = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Test" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent("Connection successful (22ms)");
  },
};

export const SaveRequiresRestart = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText("Restart DurinDoor to apply startup changes")).toBeVisible();
    await expect(canvas.getByText("Startup configuration saved")).toBeVisible();
  },
};
