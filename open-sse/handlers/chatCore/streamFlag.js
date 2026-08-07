import { FORMATS } from "../../translator/formats.js";

/**
 * Resolve whether to stream the request to the upstream provider.
 *
 * Some providers require streaming (`forceStream: true`, e.g. CommandCode) and
 * reject non-streaming requests with HTTP 400. Such providers must keep
 * streaming even when the client asked for a non-streaming/JSON response;
 * 9Router then accumulates the provider stream and returns a JSON body to the
 * client (handled downstream by handleForcedSSEToJson). (#2031)
 */
const OLLAMA_CHAT_ROUTE = /(?:^|\/)api\/chat\/?$/;

export function protocolDefaultsToStreaming({ sourceFormat, requestPath } = {}) {
  return sourceFormat === FORMATS.OLLAMA || OLLAMA_CHAT_ROUTE.test(requestPath || "");
}

/**

 * @param {object} opts
 * @param {boolean} opts.providerRequiresStreaming - provider has `forceStream: true`
 * @param {boolean} [opts.bodyStream] - the request body's `stream` value
 * @param {boolean} [opts.protocolImpliedStreaming] - omitted `stream` means streaming for
 *   the request protocol (Antigravity, Gemini, Gemini CLI, or native Ollama chat)
 * @param {string} [opts.sourceFormat] - detected request format
 * @param {string} [opts.requestPath] - request route, used for native Ollama `/api/chat`
 * @param {boolean} [opts.forceNonStreaming] - request must not stream regardless of
 *   client preference or provider default (e.g. image-generation models,
 *   providers with `forceNonStreaming: true`, deepseek-tui `-p` mode)
 * @param {boolean} [opts.clientPrefersJson] - Accept header includes `application/json`
 * @param {boolean} [opts.clientPrefersSSE] - Accept header includes `text/event-stream`
 * @returns {boolean} whether to stream to the provider
 */
export function resolveStreamFlag({
  providerRequiresStreaming,
  bodyStream,
  protocolImpliedStreaming = false,
  sourceFormat,
  requestPath,
  forceNonStreaming = false,
  clientPrefersJson = false,
  clientPrefersSSE = false,
}) {
  const omittedStreamDefaultsToTrue = protocolImpliedStreaming || protocolDefaultsToStreaming({ sourceFormat, requestPath });
  let stream = providerRequiresStreaming || bodyStream === true || (bodyStream === undefined && omittedStreamDefaultsToTrue);

  // Hard non-streaming cases (image-gen, deepseek-tui -p) override everything.
  if (forceNonStreaming) stream = false;

  // Client prefers a JSON (non-streaming) response — honor it, UNLESS the
  // provider only accepts streaming. For stream-only providers we keep
  // streaming and convert the accumulated stream to JSON for the client,
  // instead of sending stream:false upstream (which 400s). (#2031)
  if (clientPrefersJson && !clientPrefersSSE && bodyStream !== true && !providerRequiresStreaming && !omittedStreamDefaultsToTrue) {
    stream = false;
  }

  return stream;
}
