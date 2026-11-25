import { describe, expect, it } from "vitest";
import { mergeProviderConnection } from "../../src/lib/db/helpers/mergeProviderMetadata.js";
import { getConnectionErrorDisplay } from "../../src/shared/utils/connectionStatus.js";

describe("disabled connection errors", () => {
  const at = "2026-11-22T12:00:00.000Z";
  const failure = { lastError: "Invalid key", lastErrorAt: at };

  it("shows a fresh failure recorded while disabled", () => {
    const connection = mergeProviderConnection({ isActive: false }, failure);
    expect(getConnectionErrorDisplay(connection)).toEqual({ reason: "Invalid key", time: null });
    expect(getConnectionErrorDisplay(mergeProviderConnection(connection, { name: "renamed" }))).toEqual({ reason: "Invalid key", time: null });
  });

  it("hides stale failures and failures from before a manual disable", () => {
    expect(getConnectionErrorDisplay({ isActive: false, ...failure })).toBeNull();
    const disabled = mergeProviderConnection({ isActive: true, ...failure }, { isActive: false });
    expect(getConnectionErrorDisplay(disabled)).toBeNull();
    expect(getConnectionErrorDisplay(mergeProviderConnection(disabled, { isActive: true }))).toEqual({ reason: "Invalid key", time: null });
  });

  it("shows automatic-disable history until a fresh disabled failure replaces it", () => {
    const disabled = { isActive: false, autoDisabledReason: "Quota exhausted", autoDisabledAt: at, ...failure };
    expect(getConnectionErrorDisplay(disabled)).toEqual({ reason: "Quota exhausted", time: new Date(at).toLocaleString() });
    const fresh = mergeProviderConnection(disabled, { lastError: "Probe failed", lastErrorAt: "2026-11-22T13:00:00.000Z" });
    expect(getConnectionErrorDisplay(fresh)).toEqual({ reason: "Probe failed", time: null });
    expect(getConnectionErrorDisplay(mergeProviderConnection(fresh, { lastError: null, lastErrorAt: null }))).toEqual({ reason: "Quota exhausted", time: new Date(at).toLocaleString() });
    expect(getConnectionErrorDisplay(mergeProviderConnection(fresh, { isActive: true }))).toBeNull();
  });
});
