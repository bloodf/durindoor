import { expect, it } from "vitest";
import "../translator/registerAll.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { handleResponsesCore } from "../../open-sse/handlers/responsesHandler.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

it("rejects Cursor images through real handlers without provider access", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Network forbidden in offline scenario"); };
  const rows = [];
  try {
    for (const stream of [false, true]) {
      for (const provider of ["cursor", "cu"]) {
        const image = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };
        const body = { model: `${provider}/default`, stream, messages: [{ role: "user", content: [image] }] };
        const original = structuredClone(body);
        const chat = await handleChatCore({ body, modelInfo: { provider, model: "default" }, modelCapabilities: { vision: true }, credentials: null });
        expect(chat.response.status).toBe(400);
        expect(await chat.response.json()).toMatchObject({ error: { type: "invalid_request_error", message: expect.stringContaining("Cursor image input is not supported") } });
        expect(body).toEqual(original);
        const responses = await handleResponsesCore({
          body: { model: body.model, stream, input: [{ type: "function_call_output", call_id: "orphan", output: [{ type: "input_image", image_url: "https://example.invalid/image.png" }] }] },
          modelInfo: { provider, model: "default" }, credentials: null,
        });
        expect(responses.response.status).toBe(400);
        expect((await responses.response.json()).error.type).toBe("invalid_request_error");
        expect(getCapabilitiesForModel(provider, "gpt-5.2").vision).toBe(false);
        expect(() => translateRequest(FORMATS.CURSOR, FORMATS.CURSOR, "default", structuredClone(body), stream, null, provider)).toThrow(/Cursor image input is not supported/);
        rows.push(`${provider} stream=${stream}: real chat/Responses JSON 400, same-format image rejection, vision=false`);
      }
      const body = { messages: [{ role: "user", content: "Read report" }] };
      expect(translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "default", structuredClone(body), stream, null, "cursor").messages).toEqual(body.messages);
      expect(translateRequest(FORMATS.CURSOR, FORMATS.CURSOR, "default", structuredClone(body), stream, null, "cursor").messages).toEqual(body.messages);
      expect(() => translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "default", { ...body, max_tokens: 64 }, stream, null, "cursor")).toThrow(/explicit output-token limits cannot be enforced/);
      rows.push(`stream=${stream}: text translation/passthrough preserved; main token-cap rejection preserved`);
    }
    rows.push("PASS: real handlers and registered translators, no module mocks, credentials absent, network forbidden; private HOME/DATA_DIR. No live provider support claim.");
    console.log(rows.join("\n"));
  } finally {
    globalThis.fetch = oldFetch;
  }
});
