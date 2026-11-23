import React from "react";
import { expect, fn, waitFor, within } from "storybook/test";
import BulkReviewModal from "./BulkReviewModal";

const review = { action: "delete", label: "Delete", count: 2, hiddenCount: 1, names: ["First", "Second"], ids: ["first", "second"] };
export default {
  title: "Production/providers/components/BulkReviewModal",
  component: BulkReviewModal,
  args: { review, onConfirm: fn(), onCancel: fn() },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: {} } },
};
export const Open = {
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("list", { name: "Affected connections" })).toBeVisible());
    await expect(within(dialog).getByRole("status")).toBeVisible();
  },
};
export const Pending = {
  args: { busy: true },
  play: async () => {
    await expect(within(await within(document.body).findByRole("dialog")).getByRole("button", { name: "Applying..." })).toBeDisabled();
  },
};
