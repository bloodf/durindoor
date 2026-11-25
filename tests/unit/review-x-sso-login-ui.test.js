// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "../../src/app/login/page.js";

const mocks = vi.hoisted(() => ({ settings: {}, json: (body) => ({ body }) }));
vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => null }) }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => mocks.settings }));
vi.mock("@/lib/auth/dashboardSession", () => ({ getDashboardAuthSession: async () => null, isUsingDefaultPassword: async () => false }));
vi.mock("@/lib/auth/mfa", () => ({ isMfaEnabled: () => false }));
vi.mock("@/shared/ui/login/durinDoorBackdrop.js", () => ({ startDurinDoorBackdrop: () => ({ destroy() {} }) }));
const { GET } = await import("../../src/app/api/auth/status/route.js");
let root, host;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); root = null; vi.unstubAllGlobals(); });

describe("SSO login availability", () => {
  it.each([["sso", false, true], ["both", true, true], ["password", true, false]])("renders %s methods", async (authMode, passwordAvailable, oidcAvailable) => {
    mocks.settings = { authMode, oidcIssuerUrl: "https://idp.example", oidcClientId: "client", oidcClientSecret: "secret" };
    const { body } = await GET();
    expect(body).toMatchObject({ passwordAvailable, oidcAvailable });
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => body })));
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root.render(React.createElement(LoginPage)); });
    expect(!!host.querySelector("#dashboard-password")).toBe(passwordAvailable);
    expect(host.textContent.includes("Sign in with OIDC")).toBe(oidcAvailable);
  });
});
