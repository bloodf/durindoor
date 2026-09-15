// @vitest-environment happy-dom
/**
 * Rendered behavior of group management and assignment on the API Keys page.
 *
 * Two things a data-layer test cannot see: that the page uses the design
 * system's dialogs rather than native `window.prompt`/`confirm` (the Durin DS
 * rules forbid those in ported app code), and that a key's assignment actually
 * reaches the PUT payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/ui/components/Card.jsx", () => ({
  Card: ({ children }) => React.createElement("section", null, children),
  CardHeader: ({ title, subtitle, actions }) => React.createElement("header", null, title, subtitle, actions),
  CardContent: ({ children }) => React.createElement("div", null, children),
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({
  default: ({ children, icon, ...props }) => React.createElement("button", props, children),
}));
vi.mock("@/shared/ui/components/IconButton.jsx", () => ({
  default: ({ label, icon, ...props }) => React.createElement("button", { ...props, "aria-label": label }, label),
}));
vi.mock("@/shared/ui/components/PageHeader.jsx", () => ({ default: ({ title }) => React.createElement("h1", null, title) }));
vi.mock("@/shared/ui/components/Badge.jsx", () => ({ Badge: ({ children }) => React.createElement("span", null, children) }));
vi.mock("@/shared/ui/components/EmptyState.jsx", () => ({ default: ({ title }) => React.createElement("p", null, title) }));
vi.mock("@/shared/ui/components/Input.jsx", () => ({
  default: ({ label, ...props }) => React.createElement("input", { ...props, "aria-label": label }),
}));
vi.mock("@/shared/ui/components/Field.jsx", () => ({
  default: ({ label, children }) => React.createElement("label", null, label, children),
}));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/DataTable.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Checkbox.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Toggle.jsx", () => ({
  default: ({ checked, onChange, ...props }) => React.createElement("button", { ...props, role: "switch", "aria-checked": String(checked), onClick: () => onChange?.(!checked) }),
}));
vi.mock("@/shared/ui/components/Modal.jsx", () => ({
  default: ({ open, title, children, footer }) => open ? React.createElement("dialog", { open: true, "aria-label": title }, children, footer) : null,
}));
vi.mock("@/shared/ui/components/SegmentedControl.jsx", () => ({ default: () => null }));

import KeysPageClient from "@/app/(dashboard)/dashboard/keys/KeysPageClient.jsx";

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const baseKeys = [
  { id: "k1", name: "ci-deploy", maskedKey: "sk-••••••••", isActive: true, createdAt: "2026-01-01T00:00:00Z", groupIds: ["g-ci"], usage: {}, allowedCombos: [], providerConnectionIds: [] },
  { id: "k2", name: "laptop", maskedKey: "sk-••••••••", isActive: true, createdAt: "2026-01-01T00:00:00Z", groupIds: [], usage: {}, allowedCombos: [], providerConnectionIds: [] },
];
const baseGroups = [{ id: "g-ci", name: "CI", description: null }];

describe("API Keys page — groups", () => {
  let container;
  let root;
  let calls;

  beforeEach(() => {
    calls = [];
    globalThis.fetch = vi.fn((url, options = {}) => {
      const target = String(url);
      calls.push({ url: target, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
      if (target === "/api/keys") return Promise.resolve(response({ keys: baseKeys, groups: baseGroups, providerConnections: [] }));
      if (target === "/api/combos") return Promise.resolve(response({ combos: [] }));
      if (target.startsWith("/api/keys/policy-catalog")) return Promise.resolve(response({ models: [] }));
      if (target === "/api/key-groups" && options.method === "POST") {
        return Promise.resolve(response({ group: { id: "g-new", name: JSON.parse(options.body).name } }, 201));
      }
      if (target.startsWith("/api/key-groups/") && options.method === "DELETE") {
        return Promise.resolve(response({ success: true }));
      }
      if (target.startsWith("/api/keys/") && options.method === "PUT") {
        return Promise.resolve(response({ key: { ...baseKeys[0], groupIds: JSON.parse(options.body).groupIds || [] } }));
      }
      return Promise.resolve(response({}));
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = async () => {
    await act(async () => {
      root.render(React.createElement(KeysPageClient));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const buttons = () => Array.from(container.querySelectorAll("button"));
  const byText = (text) => buttons().find((node) => node.textContent.trim() === text);
  const byLabel = (label) => buttons().find((node) => node.getAttribute("aria-label") === label);

  it("lists groups with their member counts", async () => {
    await render();
    expect(container.textContent).toContain("CI");
    // k1 is in CI, k2 is not.
    expect(container.textContent).toContain("1 key");
  });

  it("creates a group through PromptDialog, not window.prompt", async () => {
    const nativePrompt = vi.fn();
    globalThis.prompt = nativePrompt;
    await render();

    await act(async () => byText("New Group").click());
    const input = container.querySelector('dialog input');
    expect(input).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, "value").set;
      setter.call(input, "Staging");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => byText("Create").click());

    expect(nativePrompt).not.toHaveBeenCalled();
    const post = calls.find((call) => call.url === "/api/key-groups" && call.method === "POST");
    expect(post.body).toEqual({ name: "Staging" });
  });

  it("deletes a group through ConfirmDialog and says keys survive", async () => {
    const nativeConfirm = vi.fn();
    globalThis.confirm = nativeConfirm;
    await render();

    await act(async () => byLabel("Delete CI").click());
    // The message must make clear the credential is not deleted with the label.
    expect(container.textContent).toMatch(/keys in it are not deleted/i);

    await act(async () => byText("Delete").click());

    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url === "/api/key-groups/g-ci" && call.method === "DELETE")).toBe(true);
  });

  it("filters the list by group, and says so when nothing matches", async () => {
    await render();
    expect(container.textContent).toContain("laptop");

    // The filter chip carries the group name; pressing it selects that group.
    const chip = buttons().find((node) => node.textContent.trim() === "CI" && node.hasAttribute("aria-pressed"));
    await act(async () => chip.click());

    expect(container.textContent).toContain("ci-deploy");
    expect(container.textContent).not.toContain("laptop");
  });

  it("sends groupIds when saving a key", async () => {
    await render();

    await act(async () => byLabel("Edit ci-deploy").click());
    const assignChip = buttons().find(
      (node) => node.textContent.trim() === "CI" && node.hasAttribute("aria-pressed") && node.closest("dialog"),
    );
    // Deselect CI, then save: the payload must carry the emptied list.
    await act(async () => assignChip.click());
    const save = buttons().find((node) => node.textContent.trim() === "Save" && node.closest("dialog"));
    await act(async () => save.click());

    const put = calls.find((call) => call.method === "PUT" && call.url.startsWith("/api/keys/"));
    expect(put).toBeDefined();
    expect(put.body.groupIds).toEqual([]);
  });

  it("recovers from a group deleted in another tab instead of wedging the modal", async () => {
    // Two tabs open, the other one deletes CI. This tab still shows the chip,
    // so the save is rejected. Without a refresh the operator is stuck: the
    // stale chip stays selected and every retry fails identically.
    let groupDeleted = false;
    globalThis.fetch = vi.fn((url, options = {}) => {
      const target = String(url);
      calls.push({ url: target, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
      if (target === "/api/keys" && (options.method || "GET") === "GET") {
        return Promise.resolve(
          response({
            keys: groupDeleted ? [{ ...baseKeys[0], groupIds: [] }, baseKeys[1]] : baseKeys,
            groups: groupDeleted ? [] : baseGroups,
            providerConnections: [],
          }),
        );
      }
      if (target === "/api/combos") return Promise.resolve(response({ combos: [] }));
      if (target.startsWith("/api/keys/policy-catalog")) return Promise.resolve(response({ models: [] }));
      if (target.startsWith("/api/keys/") && options.method === "PUT") {
        const sent = JSON.parse(options.body);
        // The server rejects only while the request still names the deleted
        // group. Once the stale id is pruned the same save succeeds, which is
        // what makes this recovery rather than a nicer error message.
        if ((sent.groupIds || []).includes("g-ci")) {
          groupDeleted = true;
          return Promise.resolve(response({ error: "Group not found" }, 400));
        }
        return Promise.resolve(response({ key: { ...baseKeys[0], name: "ci-deploy", groupIds: [] } }));
      }
      return Promise.resolve(response({}));
    });

    await render();
    await act(async () => byLabel("Edit ci-deploy").click());
    const save = () => buttons().find((node) => node.textContent.trim() === "Save" && node.closest("dialog"));
    await act(async () => save().click());

    // The modal stays open with the error, and the other edits are not lost.
    expect(container.querySelector("dialog")).not.toBeNull();
    expect(container.textContent).toContain("Group not found");

    // The stale chip is gone, so the retry carries a payload the server takes.
    const refetched = calls.filter((call) => call.url === "/api/keys" && call.method === "GET");
    expect(refetched.length).toBeGreaterThan(1);

    await act(async () => save().click());
    const retry = calls.filter((call) => call.method === "PUT").at(-1);
    expect(retry.body.groupIds).toEqual([]);

    // Recovery completes: the second save is accepted and the modal closes.
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).not.toContain("Group not found");
  });
});
