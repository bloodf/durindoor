// Translator debug page: load/save captured step files, translate between
// formats, and replay the target request as a streamed provider response.

import { reply } from "../../http.js";
import { streamForFormat } from "../../fixtures/playgroundFrames.js";
import { cannedReply, lastUserText } from "../../fixtures/playgroundReplies.js";
import { resolveModel } from "../../fixtures/playgroundCatalog.js";
import { detectFormat, fromOpenAI, headersFor, targetFor, toOpenAI } from "../../fixtures/translatorFormats.js";
import { buildTranslatorFiles } from "../../fixtures/translatorSamples.js";
import { streamFrames } from "./stream.js";

const FILES = "translator.files";
const ALLOWED = new Set([
  "1_req_client.json",
  "2_req_source.json",
  "3_req_openai.json",
  "4_req_target.json",
  "5_res_provider.txt",
  "6_res_openai.txt",
  "7_res_client.txt",
  "7_res_client.json",
]);

const fail = (error, status = 400) => reply({ success: false, error }, { status });

function translate({ body }) {
  const { step, body: payload } = body && typeof body === "object" ? body : {};
  if (!step || !payload || typeof payload !== "object") return fail("Step and body required");
  const clientBody = payload.body || payload;

  if (step === 1) {
    const { provider, model } = resolveModel(clientBody.model);
    return { success: true, result: { provider, model, sourceFormat: detectFormat(clientBody), targetFormat: targetFor(provider).format } };
  }
  if (step === 2) {
    const { model } = resolveModel(clientBody.model);
    return { success: true, result: { body: toOpenAI(detectFormat(clientBody), clientBody, model) } };
  }
  if (step === 3) {
    const { provider, model } = payload;
    if (!provider || !model) return fail("provider and model required");
    const stream = clientBody.stream !== false;
    return { success: true, result: { url: targetFor(provider).url, headers: headersFor(provider, stream), body: fromOpenAI(targetFor(provider).format, clientBody, model) } };
  }
  return fail("Invalid step (1-3)");
}

export default function registerTranslator(router, { store }) {
  store.define(FILES, () => buildTranslatorFiles());

  router.get("/api/translator/load", ({ query }) => {
    const file = query.file;
    if (!file) return fail("File parameter required");
    if (!ALLOWED.has(file)) return fail("Invalid file name");
    const content = (store.get(FILES) || {})[file];
    return content == null ? fail("File not found", 404) : { success: true, content };
  });

  router.post("/api/translator/save", ({ body }) => {
    const { file, content } = body && typeof body === "object" ? body : {};
    if (!file || content == null) return fail("File and content required");
    if (!ALLOWED.has(file)) return fail("Invalid file name");
    store.update(FILES, (files) => ({ ...(files || {}), [file]: String(content) }));
    return { success: true };
  });

  router.post("/api/translator/translate", translate);

  router.post("/api/translator/send", ({ body, signal }) => {
    const { provider, model, body: target } = body && typeof body === "object" ? body : {};
    if (!provider || !model || !target) return fail("provider, model, and body required");
    const prompt = lastUserText(target);
    const frames = streamForFormat(targetFor(provider).format, { model, prompt, text: cannedReply(prompt, model) });
    return streamFrames(frames, { signal, minMs: 8, maxMs: 16 });
  });
}
