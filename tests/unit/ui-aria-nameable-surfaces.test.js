// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";

import ManualConfigModal from "@/shared/components/ManualConfigModal.js";
import ProviderTopology from "@/app/(dashboard)/dashboard/usage/components/ProviderTopology.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mounted = [];

async function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  mounted.push({ container, root });
  return container;
}

afterEach(async () => {
  for (const { container, root } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

// ARIA prohibits an accessible name on an element with no name-supporting
// role. Assistive tech drops the label entirely, so the surface announces
// nothing. Both of these shipped that way.
describe("surfaces that carry an accessible name", () => {
  it("gives each config code block a role that can hold its filename", async () => {
    // Modal renders through a portal, so the block lands on document.body
    // rather than inside the mount container.
    await render(React.createElement(ManualConfigModal, {
      isOpen: true,
      onClose: () => {},
      configs: [{ filename: "claude.json", content: "{}" }],
    }));
    const pre = document.body.querySelector("pre");
    expect(pre, "code block renders").toBeTruthy();
    expect(pre.getAttribute("aria-label")).toBe("claude.json contents");
    // A bare `pre` has no implicit role, so the name would be discarded.
    expect(pre.getAttribute("role")).toBe("region");
  });

  it("names the topology viewport controls as a group", async () => {
    // React Flow's own Controls hardcodes aria-label onto Panel's generic
    // div and drops any role passed to it, so the group announced nothing.
    const container = await render(React.createElement(ReactFlowProvider, null,
      React.createElement(ProviderTopology, { providers: [{ id: "openai", name: "OpenAI" }] })));
    const group = container.querySelector('[role="group"]');
    expect(group, "controls expose a name-supporting role").toBeTruthy();
    expect(group.getAttribute("aria-label")).toBeTruthy();
    const names = [...container.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(expect.arrayContaining(["zoom in", "zoom out", "fit view"]));
  });
});
