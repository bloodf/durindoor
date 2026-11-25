// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import useSettingsStore, { requestSettings } from "@/store/settingsStore";
import { usePasswordPrompt } from "@/shared/hooks/usePasswordPrompt";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const refusal = () => Response.json({ error: "Enter your current dashboard password.", code: "REAUTH_REQUIRED" }, { status: 401 });
const bodies = () => fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

afterEach(() => vi.unstubAllGlobals());

describe("9router#4286: the dashboard asks for the password and retries once", () => {
  it("retries with currentPassword and keeps it out of the cached settings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(async () => refusal())
      .mockImplementation(async () => Response.json({ requireApiKey: false })));
    const confirmPassword = vi.fn(async () => "correct horse");

    const saved = await useSettingsStore.getState().patchSettings({ requireApiKey: false }, { confirmPassword });

    expect(saved).toEqual({ requireApiKey: false });
    expect(bodies()).toEqual([{ requireApiKey: false }, { requireApiKey: false, currentPassword: "correct horse" }]);
    expect(useSettingsStore.getState().settings).toEqual({ requireApiKey: false });
  });

  it("keeps the refusal when the prompt is dismissed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => refusal()));

    const response = await requestSettings({
      method: "PATCH", body: JSON.stringify({ requireLogin: false }), confirmPassword: async () => null,
    });

    expect(response.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not prompt for another 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unauthorized" }, { status: 401 })));
    const confirmPassword = vi.fn();

    await useSettingsStore.getState().patchSettings({ requireLogin: false }, { confirmPassword });

    expect(confirmPassword).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("resolves the pending prompt with the typed password or null", async () => {
    let api;
    const Probe = () => { api = usePasswordPrompt(); return null; };
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(React.createElement(Probe)));
    try {
      let first, second;
      await act(async () => { first = api.confirmPassword(); });
      expect(api.prompt.open).toBe(true);
      await act(async () => { second = api.confirmPassword(); });
      await expect(first).resolves.toBeNull();
      await act(async () => api.prompt.finish("correct horse"));
      await expect(second).resolves.toBe("correct horse");
      expect(api.prompt.open).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
