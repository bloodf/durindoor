// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { notify } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/store/notificationStore", () => ({ useNotificationStore: () => notify }));
vi.mock("@/shared/utils/visiblePoller", () => ({
  createVisiblePoller: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

import ModelAvailabilityBadge from "@/app/(dashboard)/dashboard/providers/components/ModelAvailabilityBadge.js";

const availability = {
  unavailableCount: 4,
  models: [
    {
      provider: "anthropic",
      model: "__all",
      status: "cooldown",
      until: "2026-09-12T18:30:00.000Z",
      connectionId: "account-1",
      connectionName: "Production account",
      lastError: "Rate limit reached",
    },
    {
      provider: "anthropic",
      model: "__all",
      status: "cooldown",
      until: "2026-09-12T18:30:00.000Z",
      connectionId: "account-1",
      connectionName: "Production account",
      lastError: "Rate limit reached",
    },
    {
      provider: "anthropic",
      model: "__all",
      status: "unavailable",
      connectionId: "account-2",
      connectionName: "Backup account",
      lastError: "Authentication failed",
    },
    {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      status: "cooldown",
      connectionId: "account-2",
      connectionName: "Backup account",
      lastError: "Capacity temporarily exhausted",
    },
  ],
};

const response = (body) => ({ ok: true, json: async () => body });

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ModelAvailabilityBadge", () => {
  let container;
  let root;

  beforeEach(async () => {
    globalThis.fetch = vi.fn(async (_url, options) =>
      options?.method === "POST" ? response({ ok: true }) : response(availability),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(ModelAvailabilityBadge));
      await settle();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function openPopup() {
    const trigger = container.querySelector('button[aria-haspopup="dialog"]');
    await act(async () => trigger.click());
    return container.querySelector('[role="dialog"]');
  }

  it("groups issues by provider and distinct account without exposing duplicate sentinels", async () => {
    const dialog = await openPopup();

    expect(container.textContent).toContain("4 models with issues");
    expect(dialog.textContent).toContain("anthropic");
    expect(dialog.textContent).toContain("Production account");
    expect(dialog.textContent).toContain("Backup account");
    expect(dialog.textContent).toContain("Rate limit reached");
    expect(dialog.textContent).toContain("Authentication failed");
    expect(dialog.textContent).toContain("claude-sonnet-4-5");
    expect(dialog.textContent).not.toContain("__all");
    expect(Array.from(dialog.querySelectorAll("p")).filter((node) => node.textContent === "All models")).toHaveLength(1);
    expect(Array.from(dialog.querySelectorAll("p")).filter((node) => node.textContent === "Account unavailable")).toHaveLength(1);
  });

  it("labels provider-wide clearing honestly and preserves the raw clearCooldown model", async () => {
    const dialog = await openPopup();
    const clear = dialog.querySelector('button[aria-label="Clear All models cooldown across all anthropic accounts"]');
    expect(clear).not.toBeNull();
    expect(clear.title).toBe("Clears this cooldown across all anthropic accounts");

    await act(async () => {
      clear.click();
      await settle();
    });
    const post = globalThis.fetch.mock.calls.find(([, options]) => options?.method === "POST");
    expect(JSON.parse(post[1].body)).toEqual({
      action: "clearCooldown",
      provider: "anthropic",
      model: "__all",
    });
  });
});
