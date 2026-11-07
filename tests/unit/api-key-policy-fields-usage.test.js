// @vitest-environment happy-dom
/**
 * Edit API Key: an empty lifetime-limit draft means "unlimited", so committed
 * usage must never render a "Limit reached" warning for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";
import ApiKeyPolicyFields from "@/app/(dashboard)/dashboard/endpoint/components/ApiKeyPolicyFields.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USAGE = { totalTokens: 30599943242, totalCost: 50605.3334, totalRequests: 12 };

let container;
let root;

async function renderFields(draft, usage = USAGE) {
  await act(async () => {
    root.render(
      React.createElement(ApiKeyPolicyFields, { draft, onChange: vi.fn(), catalog: [], usage }),
    );
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ApiKeyPolicyFields committed usage", () => {
  it("shows used totals and no 'Limit reached' for empty (unlimited) limits", async () => {
    await renderFields({ accessMode: "all", allowedModels: [], maxTokens: "", maxCostUsd: "" });
    const view = within(container);
    expect(view.getByText(/Committed usage: 30,599,943,242 used/)).toBeTruthy();
    expect(view.queryByText(/Limit reached/)).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
  });

  it("shows unknown-cost requests only when there are some, and they never reach a limit", async () => {
    const draft = { accessMode: "all", allowedModels: [], maxTokens: "", maxCostUsd: "1" };
    await renderFields(draft, { totalTokens: 0, totalCost: 0, totalRequests: 1200, unknownCostRequests: 1100 });
    expect(within(container).getByText(/1,200 requests · 1,100 with unknown cost/)).toBeTruthy();
    expect(within(container).queryByText(/Limit reached/)).toBeNull();
    await renderFields(draft, { totalTokens: 0, totalCost: 0, totalRequests: 2, unknownCostRequests: 0 });
    expect(within(container).queryByText(/unknown cost/)).toBeNull();
  });

  it("still flags an explicit zero limit as reached", async () => {
    await renderFields({ accessMode: "all", allowedModels: [], maxTokens: "0", maxCostUsd: "" });
    expect(within(container).getByText(/Limit reached/)).toBeTruthy();
  });
});
