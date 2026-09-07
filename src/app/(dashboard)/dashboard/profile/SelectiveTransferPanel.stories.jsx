import React from "react";
import { expect, userEvent, within } from "storybook/test";

import SelectiveTransferPanel from "./SelectiveTransferPanel";

const catalog = {
  providers: [{ id: "prov-1", name: "OpenAI" }],
  combos: [{ id: "combo-1", name: "Fast + Cheap" }],
};

const meta = {
  title: "Production/profile/SelectiveTransferPanel",
  component: SelectiveTransferPanel,
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/profile",
      routes: {
        "POST /api/settings/database/selective": async (request) => {
          const payload = await request.json();
          if (payload.action === "catalog") return { body: catalog };
          if (payload.action === "preview") {
            return {
              body: {
                providerConnections: (payload.selection?.providers ?? []).map((id) => ({ id, currentName: "OpenAI", action: "update" })),
                combos: (payload.selection?.combos ?? []).map((id) => ({ id, finalName: "Fast + Cheap", action: "update" })),
              },
            };
          }
          return { body: { ok: true } };
        },
      },
    },
  },
};

export default meta;

export const LoadCatalog = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Load transfer catalog" }));
    const passwordInput = await body.findByLabelText("Current password");
    await userEvent.type(passwordInput, "password123");
    await userEvent.click(await body.findByRole("button", { name: "Continue" }));
    await expect(await canvas.findByLabelText("OpenAI")).toBeVisible();
  },
};

export const PreviewRequiresSecondPassword = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Load transfer catalog" }));
    await userEvent.type(await body.findByLabelText("Current password"), "password123");
    await userEvent.click(await body.findByRole("button", { name: "Continue" }));
    await userEvent.click(await canvas.findByLabelText("OpenAI"));
    await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
    const secondPrompt = await body.findByLabelText("Current password");
    await userEvent.type(secondPrompt, "password123");
    await userEvent.click(await body.findByRole("button", { name: "Continue" }));
    await expect(await canvas.findByText("Export preview")).toBeVisible();
  },
};

export const ExportRequiresSecretConfirmation = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Load transfer catalog" }));
    await userEvent.type(await body.findByLabelText("Current password"), "password123");
    await userEvent.click(await body.findByRole("button", { name: "Continue" }));
    await userEvent.click(await canvas.findByRole("checkbox", { name: "Include credentials Off by default. Export needs separate confirmation." }));
    await userEvent.click(canvas.getByRole("button", { name: "Export selected" }));
    const dialog = await body.findByRole("dialog", { name: "Export credentials?" });
    await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
    await expect(dialog).toBeVisible();
  },
};
