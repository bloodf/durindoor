import React from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import AutoPingScheduleModal from "./AutoPingScheduleModal";

const connection = { id: "openai-main", name: "Production", provider: "openai" };
const schedule = { enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3 };
const fixture = {
  scenario: "default",
  pathname: "/dashboard/providers/openai",
  params: { id: "openai" },
};

const meta = {
  title: "Production/providers/AutoPingScheduleModal",
  component: AutoPingScheduleModal,
  args: {
    isOpen: true,
    connection,
    schedule,
    onSave: fn(),
    onClose: fn(),
  },
  parameters: { layout: "padded", storyFixture: fixture },
};

export default meta;

/** Enabled schedule with named fields and a deterministic slot preview. */
export const Open = {
  play: async () => {
    const view = within(document.body);
    await expect(view.getByRole("checkbox", { name: "Enable scheduled pings" })).toBeChecked();
    await expect(view.getByLabelText("Anchor time")).toHaveValue("09:30");
    await expect(view.getByText("09:30 → 14:30 → 19:30")).toBeInTheDocument();
    await expect(view.getByRole("button", { name: "Save" })).toBeEnabled();
    await expect(view.getByRole("button", { name: "Close" })).toBeEnabled();
  },
};

/** Disabled schedule: no slot fields, save still available. */
export const Empty = {
  args: { schedule: null },
  play: async () => {
    const view = within(document.body);
    await expect(view.getByRole("checkbox", { name: "Enable scheduled pings" })).not.toBeChecked();
    await expect(view.queryByLabelText("Anchor time")).not.toBeInTheDocument();
    await expect(view.getByRole("button", { name: "Save" })).toBeEnabled();
  },
};

/** Invalid anchor stays on the field and blocks save. */
export const ValidationError = {
  args: { schedule: { ...schedule, anchor: "bad" } },
  play: async () => {
    const view = within(document.body);
    const anchor = view.getByLabelText("Anchor time");
    await expect(anchor).toHaveAttribute("aria-invalid", "true");
    await expect(view.getByRole("alert")).toHaveTextContent("Use HH:MM");
    await expect(view.getByRole("button", { name: "Save" })).toBeDisabled();
  },
};

/** Save stays pending and blocks a second submit. */
export const Loading = {
  args: { onSave: () => new Promise(() => {}) },
  play: async () => {
    const view = within(document.body);
    await userEvent.click(view.getByRole("button", { name: "Save" }));
    await expect(view.getByRole("button", { name: "Saving..." })).toBeDisabled();
    await expect(view.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(view.getByRole("button", { name: "Close" })).toBeDisabled();
  },
};

/** A rejected save keeps the dialog open and announces the failure. */
export const SaveError = {
  args: { onSave: () => Promise.reject(new Error("Schedule save failed")) },
  play: async () => {
    const view = within(document.body);
    await userEvent.click(view.getByRole("button", { name: "Save" }));
    await expect(await view.findByRole("alert")).toHaveTextContent("Schedule save failed");
    await expect(view.getByRole("button", { name: "Save" })).toBeEnabled();
    await expect(view.getByRole("button", { name: "Close" })).toBeEnabled();
  },
};
