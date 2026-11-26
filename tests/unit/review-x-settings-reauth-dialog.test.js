// @vitest-environment happy-dom
/**
 * #2579: the dashboard asks for the MFA code with the password, sends both, and
 * every page that writes a gated setting offers the prompt.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import useSettingsStore from "@/store/settingsStore";
import { usePasswordPrompt } from "@/shared/hooks/usePasswordPrompt";
import ReauthDialog from "@/shared/components/ReauthDialog.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

const field = (label) => {
  const match = [...document.querySelectorAll("label")].find((node) => node.textContent.trim().startsWith(label));
  return match ? document.getElementById(match.htmlFor) : null;
};
const button = (text) => [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === text);
const type = (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
});

async function withDialog(run) {
  let api;
  const Probe = () => {
    api = usePasswordPrompt();
    return React.createElement(ReauthDialog, { prompt: api.prompt });
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(Probe)));
    await run(() => api);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

describe("#2579: re-auth dialog and retry", () => {
  it("requires the code when asked and retries the write with both", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => Response.json(
        { error: "Enter your current dashboard password.", code: "REAUTH_REQUIRED", mfaRequired: true }, { status: 401 },
      ))
      .mockImplementation(async () => Response.json({ headroomEnabled: true })));

    await withDialog(async (api) => {
      let saved;
      await act(async () => {
        saved = useSettingsStore.getState().patchSettings({ headroomEnabled: true }, { confirmPassword: api().confirmPassword });
      });
      await vi.waitFor(() => expect(field("MFA code")).not.toBeNull());
      await type(field("Dashboard password"), "correct horse");
      expect(button("Confirm").disabled).toBe(true);
      await type(field("MFA code"), " 123456 ");
      await act(async () => button("Confirm").click());

      await expect(saved).resolves.toEqual({ headroomEnabled: true });
    });
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { headroomEnabled: true },
      { headroomEnabled: true, currentPassword: "correct horse", mfaCode: "123456" },
    ]);
  });

  it("asks for the password alone when MFA is off", async () => {
    await withDialog(async (api) => {
      let answer;
      await act(async () => { answer = api().confirmPassword({ mfaRequired: false }); });
      expect(field("MFA code")).toBeNull();
      await type(field("Dashboard password"), "correct horse");
      await act(async () => button("Confirm").click());
      await expect(answer).resolves.toBe("correct horse");
    });
  });

  it.each([
    ["profile/page.js", ["outboundProxyUrl: proxyForm.outboundProxyUrl", "JSON.stringify({ outboundProxyEnabled })", "JSON.stringify({ logToolSources: enabled })", "JSON.stringify({ enableObservability: enabled })"]],
    ["token-saver/TokenSaverClient.jsx", ["body: JSON.stringify(patch)"]],
    ["headroom/HeadroomClient.js", ["body: JSON.stringify(patchValue)"]],
  ])("%s offers the prompt on its gated writes", (page, writes) => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../../src/app/(dashboard)/dashboard", page), "utf8");

    expect(source).toContain("<ReauthDialog prompt={reauth} />");
    for (const write of writes) {
      const from = source.indexOf(write);
      expect(from).toBeGreaterThan(-1);
      // The request statement ends at the next semicolon.
      expect(source.slice(from).split(";")[0]).toContain("confirmPassword");
    }
  });
});
