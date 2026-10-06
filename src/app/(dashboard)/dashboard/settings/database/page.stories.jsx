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

function startupStory(source) {
  const startupEnv = {
    path: "/data/durindoor-database.env",
    exists: source === "file",
    keys: Object.fromEntries(["DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE"].map((key) => [key, {
      source, hasFileValue: source === "file", hasProcessValue: source === "process",
    }])),
    effective: { engine: "postgres", host: "db.example.com", port: "5432", database: "durindoor", user: "durindoor", sslmode: "require" },
  };
  return {
    args: Default.args,
    parameters: {
      storyFixture: {
        ...meta.parameters.storyFixture,
        routes: {
          "GET /api/settings/database/engine": {
            body: { ...meta.parameters.storyFixture.routes["GET /api/settings/database/engine"].body, startupEnv },
          },
          "POST /api/settings/database/startup-env": {
            body: { ok: true, restartRequired: true, startupEnv: { ...startupEnv, exists: true } },
          },
        },
      },
    },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      await expect(await canvas.findByRole("heading", { name: "Startup configuration" })).toBeVisible();
      await expect(canvas.getByLabelText("Host")).toHaveValue("db.example.com");
      await expect(canvas.getByLabelText("Password")).toHaveValue("");
      await expect(canvas.getAllByText(source === "file" ? "from managed file" : "from environment")).toHaveLength(3);
    },
  };
}

export const StartupEnvFromEnvironment = startupStory("process");
export const StartupEnvFromFile = startupStory("file");
