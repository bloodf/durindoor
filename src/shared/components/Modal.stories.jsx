import React, { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Modal, { ConfirmModal } from "./Modal";

const meta = { title: "Production/shared-overlays/Modal", component: Modal };
export default meta;

function ModalScenario({ confirm = false }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {confirm ? (
        <ConfirmModal
          isOpen={open}
          onClose={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
          title="Delete request?"
          message="This action cannot be undone."
          confirmText="Delete"
        />
      ) : (
        <Modal
          isOpen={open}
          onClose={() => setOpen(false)}
          title="Request details"
          size="xl"
          footer={
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus"
            >
              Done
            </button>
          }
        >
          <p>Focused native dialog with scroll-safe content.</p>
        </Modal>
      )}
    </>
  );
}

export const Default = {
  render: () => <ModalScenario />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    // Source opens a native <dialog> on first render; the open + name
    // assertion needs a wait because the popover-style surface is mounted
    // in the same microtask as the dialog script.
    const dialog = await waitFor(() => {
      const node = body.getByRole("dialog", { name: "Request details" });
      expect(node).toBeVisible();
      return node;
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(body.queryByRole("dialog", { name: "Request details" })).toBeNull();
    });
    await userEvent.click(canvas.getByRole("button", { name: "Open dialog" }));
    await waitFor(() => {
      expect(body.getByRole("dialog", { name: "Request details" })).toBeVisible();
    });
  },
};

export const Confirmation = {
  render: () => <ModalScenario confirm />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await waitFor(() => {
      const node = body.getByRole("dialog", { name: "Delete request?" });
      expect(node).toBeVisible();
      return node;
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(body.queryByRole("dialog", { name: "Delete request?" })).toBeNull();
    });
    expect(canvas.getByRole("button", { name: "Open dialog" })).toBeVisible();
  },
};
