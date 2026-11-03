import { expect, userEvent, within, waitFor } from "storybook/test";
import AdminReview from "./AdminReview.jsx";
import { WIDGETS } from "./model.js";

export default {
  title: "Archive/Rejected v5 prototype/Start here",
  component: AdminReview,
  parameters: { layout: "fullscreen" },
  args: { page: "usage" },
};
export const ExploreWorkspace = {};
export const CustomizeDashboard = { args: { initialEditing: true } };
export const WidgetLibrary = {
  args: { initialEditing: true, initialCatalog: true },
};
export const BlankDashboard = {
  args: {
    initialWidgets: WIDGETS.map((widget) => ({ ...widget, visible: false })),
  },
};
export const CompactNavigation = { args: { compactNavigation: true } };
export const CommandSearch = { args: { initialOverlay: "command" } };
export const Notifications = { args: { initialOverlay: "notifications" } };
export const RequestInspection = { args: { initialOverlay: "request" } };
export const ConnectProvider = {
  args: { page: "providers", initialOverlay: "connection" },
};
export const CreateAccessKey = {
  args: { page: "keys", initialOverlay: "create" },
};

export const EditAndSaveWidget = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Customize dashboard" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit Request traffic", exact: true }),
    );
    const dialog = canvas.getByRole("dialog", { name: "Edit widget" });
    await userEvent.clear(within(dialog).getByLabelText("Widget name"));
    await userEvent.type(
      within(dialog).getByLabelText("Widget name"),
      "My traffic view",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Apply changes" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Save layout" }));
    await expect(
      canvas.getByRole("heading", { name: "My traffic view" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Dashboard layout saved for this preview session."),
    ).toBeVisible();
    for (const [query, name] of [
      ["providers", /Providers Routing/],
      ["usage", /Usage & analytics Workspace/],
    ]) {
      await userEvent.click(
        canvas.getByRole("button", { name: "Search workspace" }),
      );
      const search = within(
        canvas.getByRole("dialog", { name: "Go to a page" }),
      );
      await userEvent.type(
        search.getByRole("textbox", { name: "Search commands" }),
        query,
      );
      await userEvent.click(search.getByRole("button", { name }));
    }
    await expect(
      canvas.getByRole("heading", { name: "My traffic view" }),
    ).toBeVisible();
  },
};
export const KeyboardReorder = {
  args: { initialEditing: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvas.getByRole("button", {
      name: "Drag Request traffic",
      exact: true,
    });
    handle.focus();
    const columns = getComputedStyle(
      canvasElement.querySelector(".v5-widget-grid"),
    ).gridTemplateColumns.split(" ").length;
    await userEvent.keyboard("[Space]");
    await userEvent.keyboard(columns >= 3 ? "[ArrowRight]" : "[ArrowDown]");
    await waitFor(() =>
      expect(canvasElement.textContent).toContain(
        "Request traffic is over Provider distribution.",
      ),
    );
    await userEvent.keyboard("[Space]");
    await waitFor(() =>
      expect(canvasElement.querySelector(".v5-widget")).toHaveAttribute(
        "aria-label",
        "Provider distribution",
      ),
    );
  },
};
export const HideRestoreAndDiscard = {
  args: { initialEditing: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Hide Spend & budget", exact: true }),
    );
    await expect(
      canvas.queryByRole("heading", { name: "Spend & budget" }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Add widgets" }));
    const library = canvas.getByRole("dialog", { name: "Widget library" });
    await userEvent.click(
      within(library).getByRole("switch", { name: /Spend & budget/ }),
    );
    await userEvent.click(
      within(library).getByRole("button", { name: "Done" }),
    );
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Move Request traffic later",
        exact: true,
      }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Cancel", exact: true }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Discard changes" }),
    );
    await expect(
      canvas.getByRole("heading", { name: "Spend & budget" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Customize dashboard" }),
    ).toBeVisible();
  },
};
export const ProviderValidationAndRecovery = {
  args: { page: "providers", initialOverlay: "connection" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = within(
      canvas.getByRole("dialog", { name: "Connect a provider" }),
    );
    await userEvent.click(
      dialog.getByRole("button", { name: "Save connection" }),
    );
    await expect(dialog.getByRole("alert")).toHaveTextContent(
      "Check the highlighted fields",
    );
    await userEvent.type(
      dialog.getByLabelText("Connection name"),
      "Review account",
    );
    await userEvent.type(
      dialog.getByLabelText("Sample API key"),
      "sample-only",
    );
    await userEvent.click(
      dialog.getByRole("button", { name: "Save connection" }),
    );
    await expect(
      await canvas.findByText(
        "Review account saved in this preview.",
        {},
        { timeout: 5000 },
      ),
    ).toBeVisible();
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search table" }),
      "Review account",
    );
    await expect(
      canvas.getByRole("button", { name: "Review account", exact: true }),
    ).toBeVisible();
  },
};
export const FilterAndInspectRequests = {
  args: { page: "timeline" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(
      canvas.getByRole("combobox", { name: "Filter by status" }),
      "Failed",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "claude-sonnet", exact: true }),
    );
    const dialog = canvas.getByRole("dialog", { name: "Request details" });
    await expect(within(dialog).getByText("Provider timed out")).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Close dialog" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Clear filters" }),
    );
    await expect(canvas.getByText("1–5 of 7")).toBeVisible();
  },
};
export const BulkChangeAndUndo = {
  args: { page: "combos" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Select coding-fallback" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Disable selected" }),
    );
    await expect(canvas.getByText("1 sample items disabled.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
    await expect(canvas.getByText("Sample change undone.")).toBeVisible();
  },
};
export const NavigateWithCommands = {
  args: { initialOverlay: "command" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = within(canvas.getByRole("dialog", { name: "Go to a page" }));
    await userEvent.type(
      dialog.getByRole("textbox", { name: "Search commands" }),
      "database",
    );
    await userEvent.click(
      dialog.getByRole("button", { name: /Database Administration/ }),
    );
    await expect(
      canvas.getByRole("heading", { name: "Database", level: 1 }),
    ).toBeVisible();
  },
};
export const SaveSettings = {
  args: { page: "settings" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.clear(canvas.getByLabelText("Workspace name"));
    await userEvent.type(
      canvas.getByLabelText("Workspace name"),
      "My review gateway",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save changes", exact: true }),
    );
    await expect(
      await canvas.findByText(
        "Settings saved in this preview session.",
        {},
        { timeout: 5000 },
      ),
    ).toBeVisible();
    await expect(canvas.getByText("All changes saved")).toBeVisible();
    await userEvent.clear(canvas.getByLabelText("Workspace name"));
    await userEvent.type(
      canvas.getByLabelText("Workspace name"),
      "Unsaved draft",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Discard changes" }),
    );
    await expect(canvas.getByLabelText("Workspace name")).toHaveValue(
      "My review gateway",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Advanced", exact: true }),
    );
    await userEvent.clear(canvas.getByLabelText("Log retention (days)"));
    await userEvent.type(canvas.getByLabelText("Log retention (days)"), "90");
    await userEvent.click(
      canvas.getByRole("button", { name: "Discard changes" }),
    );
    await expect(canvas.getByLabelText("Log retention (days)")).toHaveValue(30);
  },
};
export const ProtectUnsavedSettings = {
  args: { page: "settings" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Workspace name"), " draft");
    await userEvent.keyboard("{Control>}k{/Control}");
    const search = within(canvas.getByRole("dialog", { name: "Go to a page" }));
    await userEvent.type(
      search.getByRole("textbox", { name: "Search commands" }),
      "quota",
    );
    await userEvent.click(
      search.getByRole("button", { name: /Quota tracker Observability/ }),
    );
    await expect(
      canvas.getByRole("dialog", { name: "Leave without saving?" }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Keep editing" }));
    await expect(canvas.getByLabelText("Workspace name")).toHaveValue(
      "My workspace draft",
    );
  },
};
export const CreateAndRevokeKey = {
  args: { page: "keys" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Create API key", exact: true }),
    );
    const create = within(
      canvas.getByRole("dialog", { name: "Create API key" }),
    );
    await userEvent.type(
      create.getByLabelText("Key name"),
      "Review access key",
    );
    await userEvent.selectOptions(
      create.getByLabelText("Expiration"),
      "30 days",
    );
    await userEvent.click(
      create.getByRole("button", { name: "Create sample key" }),
    );
    await expect(
      canvas.getByRole("dialog", { name: "Sample key created" }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "I have copied the sample key" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Review access key", exact: true }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Revoke key", exact: true }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Revoke sample key" }),
    );
    await expect(
      canvas.getByRole("row", { name: /Review access key.*Disabled/ }),
    ).toBeVisible();
  },
};
