// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import CavemanOutputPreview from "../../src/app/(dashboard)/dashboard/token-saver/components/CavemanOutputPreview.jsx";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { CAVEMAN_LEVELS } from "../../open-sse/rtk/cavemanPrompts.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/index.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function injectedInstruction(level) {
  const body = { messages: [{ role: ROLE.USER, content: "Explain the failure" }] };
  injectCaveman(body, FORMATS.OPENAI, level);
  return body.messages.find((message) => message.role === ROLE.SYSTEM)?.content;
}

describe("Caveman output instruction preview", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(level, enabled = true) {
    await act(async () => root.render(React.createElement(CavemanOutputPreview, { level, enabled })));
  }

  it("keeps the disclosure open and updates its full instruction as intensity changes", async () => {
    await render(CAVEMAN_LEVELS.LITE);
    await act(async () => container.querySelector("summary").click());

    // Update the mounted instance: selecting another intensity must not close the
    // user's disclosure or leave the previous instruction visible.
    for (const level of Object.values(CAVEMAN_LEVELS)) {
      await render(level);
      expect(container.querySelector("details").open).toBe(true);
      expect(container.querySelector("pre").textContent).toBe(injectedInstruction(level));
    }
  });

  it("keeps the selected instruction inspectable across disabled and enabled updates", async () => {
    await render(CAVEMAN_LEVELS.FULL);
    await act(async () => container.querySelector("summary").click());

    // Turning injection off does not discard an open preview or the selected
    // intensity; it remains a preview of what re-enabling Caveman will inject.
    await render(CAVEMAN_LEVELS.FULL, false);
    expect(container.querySelector("details").open).toBe(true);
    expect(container.querySelector("pre").textContent).toBe(injectedInstruction(CAVEMAN_LEVELS.FULL));

    await render(CAVEMAN_LEVELS.ULTRA, false);
    expect(container.querySelector("details").open).toBe(true);
    expect(container.querySelector("pre").textContent).toBe(injectedInstruction(CAVEMAN_LEVELS.ULTRA));

    await render(CAVEMAN_LEVELS.ULTRA, true);
    expect(container.querySelector("details").open).toBe(true);
    expect(container.querySelector("pre").textContent).toBe(injectedInstruction(CAVEMAN_LEVELS.ULTRA));
  });

  it("removes the preview rather than inventing instructions for an unknown level", async () => {
    await render(CAVEMAN_LEVELS.FULL);
    await act(async () => container.querySelector("summary").click());
    await render("unknown");
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });
});
