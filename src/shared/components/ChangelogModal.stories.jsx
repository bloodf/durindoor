import React, { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import ChangelogModal from "./ChangelogModal.js";
import { GITHUB_CONFIG } from "@/shared/constants/config";

/**
 * Production — ChangelogModal.
 *
 * HeaderMenu opens this modal; the story records the last `onClose` so the
 * close wiring is observable. `storyFixture.externalFixtures` keys the raw
 * GitHub URL the modal fetches and returns plain Markdown text. Loading,
 * error, and empty responses are exercised in three stories.
 */

const TRIGGER_CLASS =
  "h-11 min-w-11 rounded-dd bg-dd-accent px-3.5 text-[13px] font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus";

const SAMPLE_MD = `# v3.19.0

## Highlights

- One-click update is now bounded and falls back to manual install.
- Media provider health surfaced in the sidebar.

## Fixes

- OAuth callback Origin guard accepts null and empty.
- Test-saver analytics no longer drops minute 59.
`;

const CHANGELOG_KEY = `GET ${GITHUB_CONFIG.changelogUrl}`;

function ChangelogDemo({ triggerLabel, lastEventIdle }) {
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState(lastEventIdle);
  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      <span className="text-xs text-dd-muted">{event}</span>
      <ChangelogModal
        isOpen={open}
        onClose={() => {
          setEvent(`Closed at ${new Date().toLocaleTimeString()}`);
          setOpen(false);
        }}
      />
    </div>
  );
}

const meta = {
  title: "Production/Shared-Support/ChangelogModal",
  component: ChangelogModal,
  parameters: { layout: "centered" },
};

export default meta;

export const Loaded = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/",
      externalFixtures: {
        [CHANGELOG_KEY]: { body: SAMPLE_MD, contentType: "text/markdown", status: 200 },
      },
    },
  },
  render: () => <ChangelogDemo triggerLabel="Open changelog" lastEventIdle="No close event yet." />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open changelog" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Change Log" });
    await waitFor(() => expect(within(dialog).getByRole("heading", { name: "v3.19.0", level: 1 })).toBeInTheDocument());
    expect(within(dialog).getByText("One-click update is now bounded and falls back to manual install.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(canvas.getByText(/Closed at /)).toBeInTheDocument());
  },
};

export const ErrorState = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/",
      externalFixtures: {
        [CHANGELOG_KEY]: { body: "upstream is unhappy", contentType: "text/plain", status: 503 },
      },
    },
  },
  render: () => <ChangelogDemo triggerLabel="Open changelog (offline)" lastEventIdle="No close event yet." />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open changelog (offline)" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Change Log" });
    await waitFor(() => expect(within(dialog).getByText(/Failed to load changelog: HTTP 503/)).toBeInTheDocument());
  },
};

export const EmptyBody = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/",
      externalFixtures: {
        [CHANGELOG_KEY]: { body: "", contentType: "text/markdown", status: 200 },
      },
    },
  },
  render: () => <ChangelogDemo triggerLabel="Open changelog (empty)" lastEventIdle="No close event yet." />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open changelog (empty)" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Change Log" });
    await waitFor(() => expect(within(dialog).getByText("No changelog entries")).toBeInTheDocument());
  },
};
