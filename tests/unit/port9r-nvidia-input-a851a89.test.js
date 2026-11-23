// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import { EmbeddingExampleCard } from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/EmbeddingExampleCard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("sends the selected input type for NVIDIA asymmetric embeddings", async () => {
  const sent = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/tunnel/status") return Response.json({});
    sent.push(JSON.parse(options.body));
    return Response.json({ data: [] });
  }));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(EmbeddingExampleCard, { providerId: "nvidia" })));
    const view = within(host);
    await act(async () => view.getByRole("combobox", { name: "Input Type" }).click());
    await act(async () => within(document.body).getByRole("option", { name: "passage" }).click());
    await act(async () => view.getByRole("button", { name: "Run" }).click());
    expect(sent[0].input_type).toBe("passage");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
