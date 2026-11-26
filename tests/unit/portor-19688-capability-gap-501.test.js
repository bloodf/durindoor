import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const UNIMPLEMENTED = "rpc error: code = Unimplemented desc = method Rerank not implemented";
const TOO_LARGE = "rpc error: code = ResourceExhausted desc = grpc: received message larger than max (5 vs. 4)";
const log = { info() {}, warn() {}, error() {}, debug() {} };

describe("OmniRoute #19688 - a capability gap is not an account fault", () => {
  it.each([
    [501, "Not Implemented"],
    [501, ""],
    [500, UNIMPLEMENTED],
    [500, TOO_LARGE],
    [503, "the request exceeds the available context size, try increasing it"],
  ])("classifies %s %j without rotation or cooldown", (status, text) => {
    expect(checkFallbackError(status, text, 0, "openai")).toMatchObject({
      shouldFallback: false, cooldownMs: 0, requestScoped: true,
    });
  });

  it("keeps the transient cooldown for an ordinary 500", () => {
    const result = checkFallbackError(500, "internal error", 0, "openai");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("moves a combo on to the next member", async () => {
    const calls = [];
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/one", "b/two"], comboName: "gap", comboStrategy: "fallback", checkEmptyBody: false, log,
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        return model === "a/one" ?
          new Response(JSON.stringify({ error: { message: "Not Implemented" } }), { status: 501 }) :
          new Response("{}", { status: 200 });
      },
    });

    expect(calls).toEqual(["a/one", "b/two"]);
    expect(response.status).toBe(200);
  });

  describe("account state", () => {
    let dir;
    let oldDir;

    beforeEach(() => {
      oldDir = process.env.DATA_DIR;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "portor-19688-"));
      process.env.DATA_DIR = dir;
      delete global._dbAdapter;
      vi.resetModules();
    });

    afterEach(async () => {
      await disposeLoadedRequestDetailsRepo();
      try { global._dbAdapter?.instance?.close?.(); } catch {}
      delete global._dbAdapter;
      if (oldDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = oldDir;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("writes no lock for a 501, even with a retry hint", async () => {
      const database = await import("@/lib/db/index.js");
      const { markAccountUnavailable } = await import("@/sse/services/auth.js");
      const { id } = await database.createProviderConnection({
        provider: "openai", authType: "apikey", name: "account", apiKey: "sk-test",
      });
      const before = await database.getProviderConnectionById(id);

      const result = await markAccountUnavailable(id, 501, "Not Implemented", "openai", "gpt-5.4", Date.now() + 60_000);

      expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
      expect(await database.getProviderConnectionById(id)).toEqual(before);
    });
  });
});
