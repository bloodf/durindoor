import { beforeEach, describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  clearGeminiThoughtSignatures,
  clearGeminiThoughtSignatureMemoryForTests,
  getGeminiThoughtSignature,
  storeGeminiThoughtSignature,
} from "../../open-sse/services/geminiThoughtSignatureStore.js";

const signature = "EhAKDmNhY2hlZC1zaWduYXR1cmU=";

function geminiToolCall(id, name, thoughtSignature = undefined) {
  return { candidates: [{ content: { parts: [
    ...(thoughtSignature ? [{ thoughtSignature }] : []),
    { functionCall: { id, name, args: { query: id } } },
  ] } }] };
}

function claudeFollowUp(ids, signatures = {}) {
  return { messages: [
    { role: "assistant", content: ids.map((id) => ({ type: "tool_use", id, name: "Read", input: { query: id }, ...(signatures[id] ? { thoughtSignature: signatures[id] } : {}) })) },
    { role: "user", content: ids.map((id) => ({ type: "tool_result", tool_use_id: id, content: "ok" })) },
  ] };
}

const partsFor = (body) => body.contents.flatMap((content) => content.parts);
const callFor = (body, id) => partsFor(body).find((part) => part.functionCall?.id === id);

beforeEach(async () => { await clearGeminiThoughtSignatures(); });

describe("Gemini thoughtSignature direct Claude route", () => {
  it("pairs standalone signatures with next parallel function call without signature text", async () => {
    const state = { signatureNamespace: "connection-a" };
    const standalone = translateResponse(FORMATS.CLAUDE, FORMATS.GEMINI, { candidates: [{ content: { parts: [{ thoughtSignature: signature }] } }] }, state);
    const first = translateResponse(FORMATS.CLAUDE, FORMATS.GEMINI, geminiToolCall("toolu_sig_1", "read"), state);
    translateResponse(FORMATS.CLAUDE, FORMATS.GEMINI, geminiToolCall("toolu_sig_2", "read", `${signature}A`), state);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(standalone.map(JSON.stringify).join("\n")).not.toContain(signature);
    expect(first.find((event) => event.type === "content_block_start").content_block.id).toBe("toolu_sig_1");

    const translated = translateRequest(FORMATS.CLAUDE, FORMATS.GEMINI, "gemini-2.5-pro", claudeFollowUp(["toolu_sig_2", "toolu_sig_1"]), true, { _signatureNamespace: "connection-a" }, "gemini");
    expect(callFor(translated, "toolu_sig_1").thoughtSignature).toBe(signature);
    expect(callFor(translated, "toolu_sig_2").thoughtSignature).toBe(`${signature}A`);
  });

  it("reads through persisted cache after reload, replays history, expires entries, isolates connections, and honors explicit signature", async () => {
    await storeGeminiThoughtSignature("connection-a:toolu_shared", signature);
    clearGeminiThoughtSignatureMemoryForTests();
    expect(await getGeminiThoughtSignature("connection-a:toolu_shared")).toBe(signature);

    const firstReplay = translateRequest(FORMATS.CLAUDE, FORMATS.GEMINI, "gemini-2.5-pro", claudeFollowUp(["toolu_shared"]), true, { _signatureNamespace: "connection-a" }, "gemini");
    const repeatedReplay = translateRequest(FORMATS.CLAUDE, FORMATS.GEMINI, "gemini-2.5-pro", claudeFollowUp(["toolu_shared"], { toolu_shared: "client-signature" }), true, { _signatureNamespace: "connection-a" }, "gemini");
    const otherConnection = translateRequest(FORMATS.CLAUDE, FORMATS.GEMINI, "gemini-2.5-pro", claudeFollowUp(["toolu_shared"]), true, { _signatureNamespace: "connection-b" }, "gemini");

    expect(callFor(firstReplay, "toolu_shared").thoughtSignature).toBe(signature);
    expect(callFor(repeatedReplay, "toolu_shared").thoughtSignature).toBe("client-signature");
    expect(callFor(otherConnection, "toolu_shared")).toBeUndefined();
    await storeGeminiThoughtSignature("connection-a:expired", signature, Date.now() - 1);
    expect(await getGeminiThoughtSignature("connection-a:expired")).toBeNull();
  });
});
