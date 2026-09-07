import React, { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import McpMarketplaceModal from "./McpMarketplaceModal";

const REGISTRY_OK = {
  servers: [
    {
      slug: "github",
      name: "github",
      title: "GitHub",
      description: "Read repos, files, issues.",
      url: "https://api.github.com/mcp",
      oauth: true,
      toolCount: 4,
      toolNames: ["list_repos", "get_file", "search_issues", "create_issue"],
    },
    {
      slug: "fs",
      name: "fs",
      title: "Local FS",
      description: "Read & write local files.",
      url: "https://example.com/mcp/fs",
      oauth: false,
      toolCount: 2,
      toolNames: ["read", "write"],
    },
    {
      slug: "broken",
      name: "broken",
      title: "Broken Probe",
      description: "Probe fails.",
      url: "https://example.com/mcp/broken",
      oauth: false,
      toolCount: 0,
    },
  ],
};

const TOOLS_ROUTES = {
  "POST /api/cli-tools/cowork-mcp-tools": async (request) => {
    const input = await request.json();
    if (input.url === "https://api.github.com/mcp") {
      return {
        body: {
          tools: [
            { name: "list_repos" },
            { name: "get_file" },
            { name: "search_issues" },
            { name: "create_issue" },
          ],
          requiresAuth: true,
        },
        status: 200,
      };
    }
    if (input.url === "https://example.com/mcp/broken") {
      return { body: { error: "endpoint refused" }, status: 502 };
    }
    return {
      body: { tools: [{ name: "read" }, { name: "write" }] },
      status: 200,
    };
  },
};

function MarketplaceHarness({ addedNames = [] }) {
  const [added, setAdded] = useState(addedNames);
  const [payloads, setPayloads] = useState([]);
  const onAdd = (server) => {
    setAdded((prev) => [...prev, server.name]);
    setPayloads((prev) => [...prev, { name: server.name, toolNames: server.toolNames }]);
  };
  return (
    <>
      <McpMarketplaceModal isOpen onClose={() => {}} onAdd={onAdd} addedNames={added} />
      <output data-testid="payloads" className="sr-only">
        {JSON.stringify(payloads)}
      </output>
    </>
  );
}

const meta = {
  title: "Production/shared-domain/McpMarketplaceModal",
  component: McpMarketplaceModal,
  parameters: {
    layout: "centered",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/cli-tools",
      params: {},
      routes: {
        "GET /api/cli-tools/cowork-mcp-registry": { body: REGISTRY_OK, status: 200 },
        ...TOOLS_ROUTES,
      },
    },
  },
};
export default meta;

async function waitForMarketplaceDialog(body) {
  const dialog = await within(body).findByRole("dialog", { name: "Browse MCP Marketplace" });
  await waitFor(() => expect(dialog).toBeVisible());
  await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished));
  return dialog;
}

export const Browse = {
  render: () => <MarketplaceHarness />,
  play: async ({ canvasElement }) => {
    const dialog = await waitForMarketplaceDialog(canvasElement.ownerDocument.body);
    // Source fetches registry after native dialog opens; wait for rendered list.
    await waitFor(() => {
      expect(within(dialog).getByText("GitHub")).toBeVisible();
    });
    expect(within(dialog).getByText("Local FS")).toBeVisible();
  },
};

export const FilterAuthless = {
  render: () => <MarketplaceHarness />,
  play: async ({ canvasElement }) => {
    const dialog = await waitForMarketplaceDialog(canvasElement.ownerDocument.body);
    await waitFor(() => {
      expect(within(dialog).getByText("GitHub")).toBeVisible();
    });
    await userEvent.click(within(dialog).getByLabelText("Filter by auth"));
    await userEvent.click(within(dialog).getByRole("option", { name: "Authless" }));
    await waitFor(() => {
      expect(within(dialog).getByText("Local FS")).toBeVisible();
      expect(within(dialog).queryByText("GitHub")).toBeNull();
    });
  },
};

export const RequiresAuthBranch = {
  render: () => <MarketplaceHarness />,
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body;
    await waitForMarketplaceDialog(body);
    await waitFor(() => {
      expect(within(body).getByText("GitHub")).toBeVisible();
    });
    const row = within(body).getByText("GitHub").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "Add" }));
    // The OAuth-required status banner is rendered conditionally; wait for
    // it after the tools fetch completes.
    const authWarning = await waitFor(() => within(row).getByRole("status"));
    await waitFor(() => {
      expect(authWarning).toHaveTextContent(/OAuth required/);
    });
    expect(within(row).getByRole("button", { name: "Confirm add" })).toBeVisible();
  },
};

export const ProbeErrorBranch = {
  render: () => <MarketplaceHarness />,
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body;
    await waitFor(() => {
      expect(within(body).getByText("Broken Probe")).toBeVisible();
    });
    const row = within(body).getByText("Broken Probe").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "Add" }));
    const alert = await waitFor(() => within(row).getByRole("alert"));
    await waitFor(() => {
      expect(alert).toHaveTextContent("Probe failed: endpoint refused");
    });
    // Sibling rows keep their Add affordance — the failure is scoped.
    const fsRow = within(body).getByText("Local FS").closest("li");
    expect(within(fsRow).getByRole("button", { name: "Add" })).toBeEnabled();
  },
};

export const ConfirmAddPerServerRow = {
  render: () => <MarketplaceHarness />,
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body;
    const dialog = await waitForMarketplaceDialog(body);
    await waitFor(() => {
      expect(within(dialog).getByText("Local FS")).toBeVisible();
    });
    const localRow = within(dialog).getByText("Local FS").closest("li");
    await userEvent.click(within(localRow).getByRole("button", { name: "Add" }));
    // The probe is async; wait for the tool list (checkboxes) to render
    // before toggling the "write" tool. The DS Checkbox uses a
    // visually-hidden native <input type="checkbox"> wrapped in a <label>
    // whose visible text is the tool name; query by role+name from the
    // expanded Local FS row.
    const writeCheckbox = await waitFor(() =>
      within(localRow).getByRole("checkbox", { name: "write" }),
    );
    await userEvent.click(writeCheckbox);
    await userEvent.click(within(localRow).getByRole("button", { name: "Confirm add" }));
    // Only the Local FS row flips to "Added"; sibling rows still offer Add.
    await waitFor(() => {
      expect(within(localRow).getByRole("button", { name: "Added" })).toBeVisible();
    });
    const fsRow = within(dialog).getByText("Local FS").closest("li");
    const githubRow = within(dialog).getByText("GitHub").closest("li");
    expect(within(githubRow).getByRole("button", { name: "Add" })).toBeEnabled();
    expect(within(fsRow).queryByRole("button", { name: "Add" })).toBeNull();
    // Observable onAdd payload proves per-server scoping: only "read" was
    // selected before Confirm.
    const payloads = within(body).getByTestId("payloads").textContent;
    expect(payloads).toMatch(/"name":"fs"/);
    expect(payloads).toMatch(/"toolNames":\["read"\]/);
  },
};

export const RegistryError = {
  render: () => <MarketplaceHarness />,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/cli-tools",
      params: {},
      routes: {
        "GET /api/cli-tools/cowork-mcp-registry": {
          body: { error: "registry offline" },
          status: 503,
        },
        ...TOOLS_ROUTES,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body;
    const alert = await waitFor(() => within(body).getByRole("alert"));
    await waitFor(() => {
      expect(alert).toHaveTextContent("registry offline");
    });
  },
};
