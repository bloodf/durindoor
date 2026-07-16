import { describe, expect, it } from "vitest";

import { filterActiveConnections } from "../../src/shared/utils/connectionStatus.js";

describe("filterActiveConnections", () => {
  it("keeps explicitly enabled connections", () => {
    const active = { id: "active", isActive: true };
    expect(filterActiveConnections([active])).toEqual([active]);
  });

  it("hides explicitly disabled connections from the combo picker", () => {
    const disabled = { id: "disabled", isActive: false };
    expect(filterActiveConnections([disabled])).toEqual([]);
  });

  it("keeps legacy rows without the isActive flag", () => {
    const legacy = { id: "legacy" };
    expect(filterActiveConnections([legacy])).toEqual([legacy]);
  });

  it("keeps no-auth connections that are not disabled", () => {
    const noAuth = { id: "noauth", authType: "none", isActive: true };
    const noAuthLegacy = { id: "noauth-legacy", authType: "none" };
    expect(filterActiveConnections([noAuth, noAuthLegacy])).toEqual([noAuth, noAuthLegacy]);
  });

  it("filters mixed lists to only non-disabled connections", () => {
    const active = { id: "active", isActive: true };
    const legacy = { id: "legacy" };
    const disabled = { id: "disabled", isActive: false };
    expect(filterActiveConnections([active, disabled, legacy])).toEqual([active, legacy]);
  });

  it("returns an empty list for invalid input", () => {
    expect(filterActiveConnections()).toEqual([]);
    expect(filterActiveConnections(null)).toEqual([]);
  });
});
