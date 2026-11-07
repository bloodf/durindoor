import { describe, it, expect } from "vitest";
import { ConnectionCircuitManager } from "../../src/lib/routing/connectionCircuitState.js";
import { canSelectConnection, runWithConnectionRecovery } from "../../src/lib/routing/connectionRecovery.js";

const model = "model-a";
const connection = () => ({ id: "account-a", [`modelLock_${model}`]: Date.now() - 1000 });

describe("chat recovery caller", () => {
  it("admits one real dispatch and releases on stream cancellation", async () => {
    const manager = new ConnectionCircuitManager();
    const row = connection();
    const core = async () => ({ success: true, response: new Response(new ReadableStream()) });
    const first = await runWithConnectionRecovery(core, {}, row, model, model, null, manager);
    expect(canSelectConnection(row, model, model, Date.now(), manager)).toBe(false);
    const second = await runWithConnectionRecovery(() => { throw new Error("must not dispatch"); }, {}, row, model, model, null, manager);
    expect(second.connectionRecoveryBusy).toBe(true);
    await first.response.body.cancel();
    expect(canSelectConnection(row, model, model, Date.now(), manager)).toBe(true);
  });
  it("confirms recovery only after the existing success callback", async () => {
    const manager = new ConnectionCircuitManager();
    const row = connection();
    let cleared = false;
    await runWithConnectionRecovery(async (options) => {
      await options.onRequestSuccess();
      return { success: true, response: new Response("ok") };
    }, { onRequestSuccess: async () => { cleared = true; } }, row, model, model, null, manager);
    expect(cleared).toBe(true);
    expect(manager.getDiagnostics(row.id, model).state).toBe("CLOSED");
  });
  it("releases local admission failures without opening a cooldown", async () => {
    const manager = new ConnectionCircuitManager();
    const row = connection();
    await runWithConnectionRecovery(async () => ({ success: false, localAdmissionRejected: true }), {}, row, model, model, null, manager);
    expect(manager.getDiagnostics(row.id, model).state).toBe("HALF_OPEN");
    expect(canSelectConnection(row, model, model, Date.now(), manager)).toBe(true);
  });
  it("releases on abort and thrown core errors", async () => {
    const manager = new ConnectionCircuitManager();
    const row = connection();
    const controller = new AbortController();
    const result = await runWithConnectionRecovery(async () => ({ success: true, response: new Response(new ReadableStream()) }), {}, row, model, model, controller.signal, manager);
    controller.abort();
    expect(canSelectConnection(row, model, model, Date.now(), manager)).toBe(true);
    await result.response.body.cancel();
    await expect(runWithConnectionRecovery(async () => { throw new Error("core failed"); }, {}, row, model, model, null, manager)).rejects.toThrow("core failed");
    expect(canSelectConnection(row, model, model, Date.now(), manager)).toBe(true);
  });
});
