// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "trace-1" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import TimelineDetailPage from "@/app/(dashboard)/dashboard/timeline/[id]/page.js";

const ROW = { id: "trace-1", started_at: "2026-09-05T12:00:00.000Z", status: "ok", provider: "codex", model: "gpt-5", trace: {}, events: [] };

/** Click the copy action and let its promise settle. */
async function clickCopy(container) {
  const button = [...container.querySelectorAll("button")].find((b) => /Copy as JSON|Copied|Copy failed/.test(b.textContent));
  expect(button, "copy button is rendered").toBeTruthy();
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  return button;
}

describe("trace detail copy feedback", () => {
  let container;
  let root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ROW }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = async () => {
    await act(async () => root.render(React.createElement(TimelineDetailPage)));
  };

  it("confirms the copy only when the clipboard actually accepted it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render();
    const button = await clickCopy(container);
    expect(writeText).toHaveBeenCalledOnce();
    expect(button.textContent).toContain("Copied");
  });

  it("tells the user when the clipboard refused the write", async () => {
    // A denied permission or insecure context rejects. Reporting "Copied"
    // there would tell someone their trace is on the clipboard when it is not.
    const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render();
    const button = await clickCopy(container);
    expect(button.textContent).toContain("Copy failed");
    expect(button.textContent).not.toContain("Copied");
  });
});
