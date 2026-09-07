import React from "react";

globalThis.React ??= React;

import { expect, userEvent, waitFor, within } from "storybook/test";

import CombosPage from "./page.js";
import CombosError from "./error.js";

const meta = {
  title: "Production/Combos/CombosPage",
  component: CombosPage,
  parameters: { layout: "fullscreen" },
};

export default meta;

const baseCombos = [
  {
    id: "combo-prod-1",
    name: "production-fallback",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-pro"],
    capabilities: null,
    allowedConnectionIds: [],
  },
  {
    id: "combo-prod-2",
    name: "round-robin-pool",
    models: ["openai/gpt-4.1", "openai/gpt-4o-mini"],
    capabilities: null,
    allowedConnectionIds: [],
  },
  {
    id: "combo-prod-3",
    name: "fusion-panel",
    models: ["anthropic/claude-sonnet-4.5", "google/gemini-2.5-pro", "openai/o3-mini"],
    capabilities: null,
    allowedConnectionIds: [],
  },
];
const fixtureCombosError = new Error("boom");
let loggedCombosErrorCount = 0;

const fixtureRoutes = (scenario) => {
  if (scenario === "empty") {
    return {
      "GET /api/combos": { body: { combos: [] } },
      "GET /api/providers": { body: { connections: [] } },
      "GET /api/settings": { body: {} },
      "GET /api/connection-groups": { body: { groups: [] } },
    };
  }
  return {
    "GET /api/combos": { body: { combos: baseCombos } },
    "GET /api/providers": {
      body: {
        connections: [
          { id: "conn-openai-1", name: "OpenAI prod", provider: "openai", status: "active" },
          { id: "conn-anthropic-1", name: "Anthropic team", provider: "anthropic", status: "active" },
        ],
      },
    },
    "GET /api/settings": { body: {} },
    "GET /api/connection-groups": {
      body: {
        groups: [
          { id: "grp-prod", name: "Production", connectionIds: ["conn-openai-1", "conn-anthropic-1"] },
        ],
      },
    },
  };
};

function CombosErrorResetHarness() {
  const [failed, setFailed] = React.useState(true);
  return failed
    ? <CombosError error={fixtureCombosError} reset={() => setFailed(false)} />
    : <main aria-label="Combos restored"><p>Combos restored</p></main>;
}

export const Default = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/combos",
      routes: fixtureRoutes("default"),
    },
  },
  play: async () => {
    const canvas = within(document.body);
    const card = (await canvas.findByText("production-fallback")).closest(".group");
    await expect(card).toBeInTheDocument();
    await expect(within(card).getByText("openai/gpt-4o")).toBeVisible();
    await expect(within(card).getByLabelText("Strategy for production-fallback")).toBeVisible();
  },
};

export const Empty = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/combos",
      routes: fixtureRoutes("empty"),
    },
  },
};

export const LoadFailure = {
  render: () => <CombosErrorResetHarness />,
  parameters: { layout: "fullscreen" },
  beforeEach: () => {
    const originalError = console.error;
    loggedCombosErrorCount = 0;
    console.error = (...args) => {
      if (args[0] === "Combos page error:" && args[1] === fixtureCombosError) {
        loggedCombosErrorCount += 1;
        return;
      }
      originalError(...args);
    };
    return () => {
      console.error = originalError;
    };
  },
  play: async () => {
    const canvas = within(document.body);
    await expect(canvas.getByText("Something went wrong")).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Back to Dashboard" })).toHaveAttribute(
      "href",
      "/dashboard"
    );
    await waitFor(() => expect(loggedCombosErrorCount).toBe(1));
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(canvas.getByRole("main", { name: "Combos restored" })).toHaveTextContent("Combos restored");
  },
};

export const DeleteFlow = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/combos",
      routes: {
        ...fixtureRoutes("default"),
        "DELETE /api/combos/combo-prod-2": { body: { ok: true } },
      },
    },
  },
  play: async () => {
    const canvas = within(document.body);
    const deleteButtons = await canvas.findAllByRole("button", { name: "Delete" });
    await userEvent.click(deleteButtons[1]);
    const dialog = await canvas.findByRole("dialog");
    await expect(within(dialog).getByText("Delete Combo")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(canvas.queryByText("round-robin-pool")).not.toBeInTheDocument());
  },
};

export const CreateFlow = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/combos",
      routes: {
        ...fixtureRoutes("default"),
        "GET /api/models/alias": { body: { aliases: {} } },
      },
    },
  },
  play: async () => {
    const canvas = within(document.body);
    await userEvent.click(await canvas.findByRole("button", { name: "Create Combo" }));
    const dialog = await canvas.findByRole("dialog");
    const nameInput = within(dialog).getByLabelText("Combo Name");
    await userEvent.type(nameInput, "demo-combo");
    await expect(nameInput).toHaveValue("demo-combo");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(canvas.queryByRole("dialog")).not.toBeInTheDocument());
  },
};

export const EditFlow = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/combos",
      routes: {
        ...fixtureRoutes("default"),
        "GET /api/models/alias": { body: { aliases: {} } },
        "PUT /api/combos/combo-prod-1": { body: { ok: true } },
      },
    },
  },
  play: async () => {
    const canvas = within(document.body);
    const comboCard = (await canvas.findByText("production-fallback")).closest(".group");
    await userEvent.click(within(comboCard).getByRole("button", { name: "Edit" }));
    const dialog = await canvas.findByRole("dialog");
    await expect(within(dialog).getByText("Edit Combo")).toBeInTheDocument();
    await expect(within(dialog).getByDisplayValue("production-fallback")).toBeInTheDocument();
    const firstModel = within(dialog).getByText("openai/gpt-4o").closest(".group");
    await expect(within(firstModel).getByRole("button", { name: "Move up" })).toBeDisabled();
    await expect(within(dialog).getByText("anthropic/claude-sonnet-4.5")).toBeVisible();
    await expect(within(dialog).getByText("google/gemini-2.5-pro")).toBeVisible();
    const lastModel = within(dialog).getByText("google/gemini-2.5-pro").closest(".group");
    await expect(within(lastModel).getByRole("button", { name: "Move down" })).toBeDisabled();
  },
};

export const SaveFailure = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/combos",
      routes: {
        ...fixtureRoutes("default"),
        "GET /api/models/alias": { body: { aliases: {} } },
        "POST /api/combos": { status: 400, body: { error: "Failed to create combo" } },
      },
    },
  },
  play: async () => {
    const canvas = within(document.body);
    await userEvent.click(await canvas.findByRole("button", { name: "Create Combo" }));
    const dialog = await canvas.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Combo Name"), "demo");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    const alert = await within(dialog).findByRole("alert");
    await expect(alert).toHaveTextContent("Failed to create combo");
    await expect(dialog).toBeInTheDocument();
  },
};

export const LoadFailureError = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/combos",
      routes: {
        "GET /api/combos": { status: 500, body: { error: "Upstream broken" } },
        "GET /api/providers": { body: { connections: [] } },
        "GET /api/settings": { body: {} },
        "GET /api/connection-groups": { body: { groups: [] } },
        "GET /api/models/alias": { body: { aliases: {} } },
      },
    },
  },
  play: async () => {
    const canvas = within(document.body);
    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent("Upstream broken");
    await expect(canvas.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Create Combo" }));
    const dialog = await canvas.findByRole("dialog");
    await expect(within(dialog).getByRole("heading", { name: "Create Combo" })).toBeVisible();
    await expect(within(dialog).getByLabelText("Combo Name")).toBeVisible();
    await expect(within(dialog).getByText("No models added yet")).toBeVisible();
  },
};
