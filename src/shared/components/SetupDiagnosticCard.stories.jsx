import React from "react";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";

import SetupDiagnosticCard from "./SetupDiagnosticCard";

globalThis.React ??= React;

const sampleDiagnostic = {
  code: "EXTERNAL_INSTALL_DETECTED",
  summary: "Headroom binary is installed in a location we do not manage.",
  detail: "Move it into a user-owned directory and rerun the install command.",
  fixes: [
    {
      label: "Reinstall Headroom into your home directory",
      command: "curl -fsSL https://headroom.example/install.sh | sh",
      url: "https://headroom.example/docs/install",
    },
    {
      label: "Open the setup log",
      url: "https://headroom.example/docs/troubleshoot",
    },
  ],
  logTail: "2026-09-05T10:11:12Z headroom: probe failed; will retry in 30s\n",
  docs: "https://headroom.example/docs",
};

const meta = {
  title: "Production/shared-provider/SetupDiagnosticCard",
  component: SetupDiagnosticCard,
  parameters: {
    layout: "padded",
    storyFixture: { scenario: "default", pathname: "/dashboard/headroom" },
  },
};

export default meta;

export const WithFixesAndRetry = {
  args: {
    diagnostic: sampleDiagnostic,
    onRetry: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText(/Reinstall Headroom/i)).toBeInTheDocument();
      expect(canvas.getByText("Copy")).toBeInTheDocument();
      expect(canvas.getByText("Retry")).toBeInTheDocument();
      expect(canvas.getByText(/Show recent Headroom log output/i)).toBeInTheDocument();
      expect(canvas.getByText("Open Headroom documentation")).toBeInTheDocument();
    });
  },
};

// Private command copy: click Copy and assert clipboard write + button label
// flip to "Copied". The Copy button only renders for fixes whose source
// payload contains a `command` field; the second fix is a docs link and
// therefore has no Copy button, so we scope the click to the first fix.
export const CopyCommandFlipsToCopied = {
  args: { diagnostic: sampleDiagnostic },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The fix list renders one Copy button per fix that owns a `command`.
    // Wait for the data-table-style row mount, then resolve the exact
    // command we expect to be written to the clipboard from the
    // diagnostic fixture.
    const fix = sampleDiagnostic.fixes[0];
    expect(fix?.command).toBeDefined();
    const writeText = spyOn(navigator.clipboard, "writeText").mockImplementation(fn(() => Promise.resolve()));
    try {
      // There is exactly one Copy button in this fixture (only the first
      // fix has a `command`). Use getAllByRole if more appear in the future.
      const copy = await waitFor(() => canvas.getByRole("button", { name: "Copy" }));
      await userEvent.click(copy);
      // The source flips its label to "Copied" inside the same button
      // immediately after `copy()` resolves; the await above gives the
      // microtask a chance to commit, but the post-click label still needs
      // a wait because the hook uses a timer to reset.
      await waitFor(() => {
        expect(canvas.getByRole("button", { name: "Copied" })).toBeInTheDocument();
      });
      expect(writeText).toHaveBeenCalledWith(fix.command);
    } finally {
      writeText.mockRestore();
    }
  },
};

// Private retry: clicking Retry must invoke the supplied callback.
export const RetryInvokesCallback = {
  args: {
    diagnostic: sampleDiagnostic,
  },
  render: (args) => {
    return <SetupDiagnosticCardProbe {...args} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const retry = await waitFor(() => canvas.getByRole("button", { name: "Retry" }));
    await userEvent.click(retry);
    await waitFor(() => {
      expect(canvas.getByTestId("retry-counter")).toHaveTextContent("1");
    });
  },
};

function SetupDiagnosticCardProbe(props) {
  const [count, setCount] = React.useState(0);
  return (
    <>
      <SetupDiagnosticCard {...props} onRetry={() => setCount((c) => c + 1)} />
      <span data-testid="retry-counter">{count}</span>
    </>
  );
}

export const WithoutDiagnosticsRendersNothing = {
  args: { diagnostic: null },
  play: async ({ canvasElement }) => {
    // Source returns null when diagnostic is falsy; the section root is
    // absent. The fixture-level root <div> still exists, so assert the
    // alert role has no matching nodes and the outer section is missing.
    await waitFor(() => {
      expect(within(canvasElement).queryByRole("alert")).toBeNull();
    });
  },
};
