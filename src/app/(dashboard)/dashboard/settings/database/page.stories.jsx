import React from "react";
import { expect, within } from "storybook/test";

import DatabaseSettingsPage from "./page";

const meta = {
  title: "Production/settings/DatabaseSettingsPage",
  component: DatabaseSettingsPage,
  parameters: {
    layout: "fullscreen",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/settings/database",
      routes: {
        "GET /api/settings/database/engine": {
          body: {
            activeEngine: "sqlite",
            databaseEngine: "sqlite",
            databaseEngineError: null,
            databaseCutoverAt: null,
            databaseCutoverSchemaVersion: null,
            databasePgVersion: 18,
            databasePgFeatures: {
              aio: { enabled: true, requires: ">=18" },
              parallelGin: { enabled: true, requires: ">=17" },
              streamingIo: { enabled: true, requires: ">=17" },
            },
            effectiveCapabilities: {
              aio: { enabled: true, requires: ">=18", requiresMajor: 18, clusterMajor: 18 },
              parallelGin: { enabled: true, requires: ">=17", requiresMajor: 17, clusterMajor: 18 },
              streamingIo: { enabled: true, requires: ">=17", requiresMajor: 17, clusterMajor: 18 },
            },
            versionMismatch: false,
            operatorDisabled: [],
            postgresHost: "db.example.com",
            postgresPort: 5432,
            postgresDatabase: "durindoor",
            postgresUser: "durindoor",
            postgresSslmode: "require",
            postgresAuthSource: "settings",
            snapshots: [],
          },
        },
      },
    },
  },
};

export default meta;

export const Default = {
  args: {
    // Storybook seam: the fixture fetch mock answers regardless of the
    // password header, so any non-empty value unlocks the page.
    initialPassword: "storybook",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Database Settings" })).toBeVisible();
    await expect(canvas.getByText("sqlite")).toBeVisible();
  },
};
