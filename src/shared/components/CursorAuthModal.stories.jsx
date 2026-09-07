import React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import CursorAuthModal from "./CursorAuthModal";

const meta = {
  title: "Production/shared-kiro/CursorAuthModal",
  component: CursorAuthModal,
  args: { isOpen: true, onSuccess: fn(), onClose: fn() },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { "GET /api/oauth/cursor/auto-import": { status: 200, body: { found: true, accessToken: "tok_abc123", machineId: "machine-xyz" } } } } },
};
export default meta;

// Native <dialog> becomes visible only after Modal's post-commit showModal()
// effect runs. Waiting on findByRole alone can resolve before that paint,
// so re-check visibility inside waitFor before scoping queries to it.
async function getVisibleDialog(canvasElement, name) {
  const body = canvasElement.ownerDocument.body;
  const dialog = await waitFor(() => {
    const dialog = within(body).getByRole("dialog", { name });
    expect(dialog).toBeVisible();
    return dialog;
  });
  await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
  return dialog;
}

export const AutoDetected = {
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Cursor IDE"));
    await waitFor(() => expect(canvas.getByText(/auto-detected from cursor ide successfully/i)).toBeVisible());
    await expect(canvas.getByRole("button", { name: /import token/i })).toBeEnabled();
  },
};

export const AutoDetecting = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { "GET /api/oauth/cursor/auto-import": () => new Promise(() => {}) } } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Cursor IDE"));
    await expect(await canvas.findByRole("status")).toHaveTextContent(/auto-detecting tokens/i);
  },
};

export const WindowsManual = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { "GET /api/oauth/cursor/auto-import": { status: 200, body: { found: false, windowsManual: true } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Cursor IDE"));
    await waitFor(() => expect(canvas.getByRole("button", { name: /retry/i })).toBeVisible());
    await waitFor(() => expect(canvas.getByText(/could not read cursor database automatically/i)).toBeVisible());
  },
};

export const ManualImportValidation = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { "GET /api/oauth/cursor/auto-import": { status: 200, body: { found: false, windowsManual: true } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Cursor IDE"));
    const notice = await canvas.findByText("Could not read Cursor database automatically.");
    await expect(notice).toBeVisible();
    const importButton = await canvas.findByRole("button", { name: /import token/i });
    await expect(importButton).toBeDisabled();
    await userEvent.type(await canvas.findByLabelText(/access token/i), "tok_manual");
    await userEvent.type(await canvas.findByLabelText(/machine id/i), "machine-manual");
    await expect(importButton).toBeEnabled();
  },
};

export const ManualImportFailure = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { "GET /api/oauth/cursor/auto-import": { status: 200, body: { found: false, error: "Cursor IDE not found" } }, "POST /api/oauth/cursor/import": { status: 400, body: { error: "Cursor token rejected" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Cursor IDE"));
    await userEvent.type(await canvas.findByLabelText(/access token/i), "tok_manual");
    await userEvent.type(await canvas.findByLabelText(/machine id/i), "machine-manual");
    await userEvent.click(await canvas.findByRole("button", { name: /import token/i }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(/cursor token rejected/i);
  },
};

export const ManualImportSuccess = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { "GET /api/oauth/cursor/auto-import": { status: 200, body: { found: false, error: "Cursor IDE not found" } }, "POST /api/oauth/cursor/import": { status: 200, body: { ok: true } } } } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Cursor IDE"));
    await userEvent.type(await canvas.findByLabelText(/access token/i), "tok_manual");
    await userEvent.type(await canvas.findByLabelText(/machine id/i), "machine-manual");
    await userEvent.click(await canvas.findByRole("button", { name: /import token/i }));
    await expect(args.onSuccess).toHaveBeenCalled();
    await expect(args.onClose).toHaveBeenCalled();
  },
};

export const Importing = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers", params: {}, routes: { "GET /api/oauth/cursor/auto-import": { status: 200, body: { found: true, accessToken: "tok_abc123", machineId: "machine-xyz" } }, "POST /api/oauth/cursor/import": () => new Promise(() => {}) } } },
  play: async ({ canvasElement }) => {
    const canvas = within(await getVisibleDialog(canvasElement, "Connect Cursor IDE"));
    await userEvent.click(await canvas.findByRole("button", { name: /import token/i }));
    await expect(await canvas.findByRole("button", { name: /import token/i })).toHaveAttribute("aria-busy", "true");
  },
};
