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
    await within(document.body).findByRole("dialog");
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
  args: { schedule: null, onSave: fn() },
  play: async ({ args }) => {
    await within(document.body).findByRole("dialog");
    const view = within(document.body);
    await expect(view.getByRole("checkbox", { name: "Enable scheduled pings" })).not.toBeChecked();
    await expect(view.queryByLabelText("Anchor time")).not.toBeInTheDocument();
    await expect(view.getByRole("button", { name: "Save" })).toBeEnabled();
    await userEvent.click(view.getByRole("button", { name: "Save" }));
    await expect(args.onSave).toHaveBeenCalledWith(null);
  },
};

/** Window outside the supported range blocks save and explains the valid range. */
export const InvalidWindow = {
  args: { schedule: { ...schedule, windowHours: 25 } },
  play: async () => {
    await within(document.body).findByRole("dialog");
    const view = within(document.body);
    await expect(view.getByLabelText("Window (hours)")).toHaveAttribute("aria-invalid", "true");
    await expect(view.getByRole("alert")).toHaveTextContent("0.5 to 24");
    await expect(view.getByRole("button", { name: "Save" })).toBeDisabled();
  },
};

/** Slot count above the window-derived maximum blocks save. */
export const SlotsAboveMaximum = {
  args: { schedule: { ...schedule, windowHours: 5, slotsPerDay: 5 } },
  play: async () => {
    await within(document.body).findByRole("dialog");
    const view = within(document.body);
    await expect(view.getByLabelText("Pings per day")).toHaveAttribute("aria-invalid", "true");
    await expect(view.getByRole("alert")).toHaveTextContent("1 to 4");
    await expect(view.getByRole("button", { name: "Save" })).toBeDisabled();
  },
};

/** Enabling a disabled schedule reveals its deterministic slot preview. */
export const EnableSchedule = {
  args: { schedule: { ...schedule, enabled: false } },
  play: async () => {
    await within(document.body).findByRole("dialog");
    const view = within(document.body);
    const enabled = view.getByRole("checkbox", { name: "Enable scheduled pings" });
    await expect(enabled).not.toBeChecked();
    await userEvent.click(enabled);
    await expect(enabled).toBeChecked();
    await expect(view.getByText("09:30 → 14:30 → 19:30")).toBeInTheDocument();
  },
};

/** Invalid anchor stays on the field and blocks save. */
export const ValidationError = {
  args: { schedule: { ...schedule, anchor: "bad" } },
  play: async () => {
    await within(document.body).findByRole("dialog");
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
    await within(document.body).findByRole("dialog");
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
    await within(document.body).findByRole("dialog");
    const view = within(document.body);
    await userEvent.click(view.getByRole("button", { name: "Save" }));
    await expect(await view.findByRole("alert")).toHaveTextContent("Schedule save failed");
    await expect(view.getByRole("button", { name: "Save" })).toBeEnabled();
    await expect(view.getByRole("button", { name: "Close" })).toBeEnabled();
  },
};
