import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { ConnectionCircuitManager } from "../../src/lib/routing/connectionCircuitState.js";
import { canSelectConnection, runWithConnectionRecovery } from "../../src/lib/routing/connectionRecovery.js";

const model = "model-a";
const row = () => ({ id: "connection-a", ["modelLock_model-a"]: 1 });

describe("connection recovery integration", () => {
  it("admits one concurrent probe and allows recovery after cancellation", async () => {
    const manager = new ConnectionCircuitManager();
    const connection = row();
    let dispatches = 0;
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const core = async () => { dispatches++; await pending; return { success: false }; };
    const attempts = Array.from({ length: 8 }, () =>
      runWithConnectionRecovery(core, {}, connection, model, model, null, manager));
    expect(dispatches).toBe(1);
    resolve();
    const results = await Promise.all(attempts);
    expect(results.filter((result) => result.connectionRecoveryBusy)).toHaveLength(7);
    expect(canSelectConnection(connection, model, model, Date.now(), manager)).toBe(true);
  });

  it("fences an in-flight probe after a manual reset", async () => {
    const manager = new ConnectionCircuitManager();
    const connection = row();
    let complete;
    const pending = new Promise((done) => { complete = done; });
    const attempt = runWithConnectionRecovery(async (options) => {
      await pending;
      await options.onRequestSuccess();
      return { success: true };
    }, {}, connection, model, model, null, manager);
    manager.reset(connection.id);
    complete();
    await attempt;
    expect(manager.getDiagnostics(connection.id, model).state).toBe("CLOSED");
  });

  it("keeps client errors, policy refusals and aborts out of fallback", () => {
    for (const [status, message] of [[400, "invalid_request_error"], [400, "provider_request_rejected"], [499, "aborted"]]) {
      expect(checkFallbackError(status, message).shouldFallback).toBe(false);
    }
    expect(checkFallbackError(503, "service unavailable").shouldFallback).toBe(true);
  });
});
