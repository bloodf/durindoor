import React from "react";
import { expect, userEvent, within } from "storybook/test";
import PostgresConnectionTarget from "./PostgresConnectionTarget.jsx";

const args = { effective: { host: "db.example.test", port: "5432", database: "durindoor", user: "operator", sslmode: "require" }, password: "fixture", onUnauthorized: () => {}, onPersisted: async () => {} };

export default { title: "Production/settings/PostgresConnectionTarget", component: PostgresConnectionTarget, args, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/settings/database", routes: { "POST /api/settings/database/test": { body: { ok: true, latencyMs: 18, serverVersion: "16.4" } } } } } };

export const SavesTarget = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Test connection and save target" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent("Target saved. Connected in 18ms");
  },
};

export const Failure = {
  parameters: { storyFixture: { scenario: "error", pathname: "/dashboard/settings/database", routes: { "POST /api/settings/database/test": { status: 400, body: { error: "Target unavailable" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Test connection and save target" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Target unavailable");
  },
};
