/** ChatGPT Web stream helpers. The HTTP entry preserves the public transport API. */
import { cleanChatGptText } from "./citations.js";
import { extractContent } from "./images.js";


// ─── OpenAI SSE format ──────────────────────────────────────────────────────

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}


/**
 * Resolves a ChatGPT asset_pointer to a downloadable URL, given the live
 * conversation_id (needed for sediment:// pointers). Returns null on failure
 * so the caller can decide whether to surface a placeholder or skip silently.
 */
/**
 * True when ChatGPT emitted an image asset pointer (the image WAS generated
 * upstream) but none of the pointers could be resolved to a downloadable URL
 * — so the assistant text carries no image markdown. Lets callers surface an
 * accurate "generated but not retrievable" error instead of the misleading
 * "no image was produced". Escalated mesh report: image visible in the ChatGPT
 * chat but returned to DurinDoor as a bare "completed without image markdown".
 */
function detectImageResolutionFailure(pointerCount, resolvedCount) {
  return pointerCount > 0 && resolvedCount === 0;
}


/** Build the final markdown block for a list of resolved image URLs. */
function imageMarkdown(urls) {
  if (urls.length === 0) return "";
  // Two leading newlines → ensure separation from any prior text the model
  // produced ("Here is your kitten:\n\n![image](...)"). One image per line.
  return "\n\n" + urls.map((u) => `![image](${u})`).join("\n\n");
}


async function resolveImagePointers(
  pointers,
  conversationId,
  resolver,
  log,
  fallbackParentMessageId
) {
  if (!pointers || pointers.length === 0 || !resolver) return [];
  const urls = [];
  for (const ref of pointers) {
    try {
      const url = await resolver(
        ref.pointer,
        conversationId,
        ref.messageId ?? fallbackParentMessageId
      );
      if (url) urls.push(url);
    } catch (err) {
      log?.warn?.(
        "CGPT-WEB",
        `Image resolve failed (${ref.pointer}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return urls;
}


function buildStreamingResponse(
  eventStream,
  model,
  cid,
  created,
  resolver,
  // Optional poller for async image_gen — when ChatGPT processes the request
  // out-of-band ("Lots of people are creating images right now"), the SSE
  // stream finishes without an image_asset_pointer. The executor passes a
  // closure here that knows how to poll the conversation endpoint.
  pollAsyncImage,
  // Native Temporary Chat handoff continuation. ChatGPT provides a short-lived
  // conduit token, which resumes the turn without saving it to chat history.
  resumeFinalAnswer,
  // Legacy fallback for handoffs that omit the conduit token.
  pollFinalAnswer,
  log,
  signal
) {
  const encoder = new TextEncoder();

  return new ReadableStream(
    {
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: cid,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [
                  { index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null },
                ],
              })
            )
          );

          let conversationId = null;
          let imagePointers;
          let imageGenAsync = false;
          let handoff = false;
          let resumeToken = null;
          let emittedText = "";
          let polledFinalAnswer = null;
          let parentCandidateMessageId = null;

          const emitRenderedDelta = (content) => {
            if (!content) return;
            emittedText += content;
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [
                    {
                      index: 0,
                      delta: { content },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                })
              )
            );
          };

          const emitRenderedAnswer = (rawText, metadata) => {
            const rendered = cleanChatGptText(rawText, metadata);
            if (!rendered || rendered.length <= emittedText.length) return;
            if (!rendered.startsWith(emittedText)) {
              // We cannot retract bytes already streamed. This should be rare;
              // it mainly protects clients if ChatGPT rewrites earlier text.
              const common = commonPrefixLength(rendered, emittedText);
              if (common < emittedText.length) return;
            }
            emitRenderedDelta(rendered.slice(emittedText.length));
          };

          const appendFinalAnswer = (text, metadata) => {
            const cleaned = cleanChatGptText(text, metadata);
            const finalTrimmed = cleaned.trim();
            if (!finalTrimmed) return;
            const emittedTrimmed = emittedText.trim();
            if (emittedTrimmed === finalTrimmed || emittedTrimmed.endsWith(finalTrimmed)) return;
            const prefix = emittedTrimmed && !emittedText.endsWith("\n") ? "\n\n" : "";
            emitRenderedDelta(`${prefix}${cleaned}`);
          };

          // Heartbeat: long async work (Pro polling, WebSocket image-gen,
          // 2-3 MB image fetch) leaves the SSE quiet and Open WebUI times out
          // at ~30s (`disconnect: ResponseAborted`). SSE comments and empty
          // `delta:{}` chunks are both filtered upstream
          // (`hasValuableContent` in open-sse/utils/streamHelpers.js), so
          // heartbeats are zero-width-space content deltas (`"​"`): they pass
          // the filter and render invisibly.
          const startHeartbeat = (intervalMs = 5_000) => {
            const heartbeatChunk = sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [{ index: 0, delta: { content: "​" }, finish_reason: null, logprobs: null }],
            });
            const timer = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(heartbeatChunk));
              } catch {
                // Controller may already be closed if the client disconnected
                // — just stop firing.
                console.warn("[chatgpt-web] heartbeat enqueue failed - controller closed");
                clearInterval(timer);
              }
            }, intervalMs);
            return () => clearInterval(timer);
          };

          for await (const chunk of extractContent(eventStream, signal)) {
            if (chunk.conversationId) conversationId = chunk.conversationId;
            if (chunk.messageId) parentCandidateMessageId = chunk.messageId;
            if (chunk.handoff) handoff = true;
            if (chunk.resumeToken) resumeToken = chunk.resumeToken;
            if (chunk.error) {
              controller.enqueue(
                encoder.encode(
                  sseChunk({
                    id: cid,
                    object: "chat.completion.chunk",
                    created,
                    model,
                    system_fingerprint: null,
                    choices: [
                      {
                        index: 0,
                        delta: { content: `[Error: ${chunk.error}]` },
                        finish_reason: null,
                        logprobs: null,
                      },
                    ],
                  })
                )
              );
              break;
            }

            if (chunk.done) {
              imagePointers = chunk.imagePointers;
              imageGenAsync = chunk.imageGenAsync ?? false;
              handoff = handoff || (chunk.handoff ?? false);
              if (chunk.resumeToken) resumeToken = chunk.resumeToken;
              if (chunk.messageId) parentCandidateMessageId = chunk.messageId;
              break;
            }

            if (chunk.answer) {
              emitRenderedAnswer(chunk.answer, chunk.metadata);
            }
          }

          if (resumeFinalAnswer && conversationId && handoff && resumeToken) {
            const stopHb = startHeartbeat();
            try {
              const resumed = await resumeFinalAnswer(conversationId, resumeToken);
              if (resumed?.text) {
                polledFinalAnswer = resumed;
                if (resumed.messageId) parentCandidateMessageId = resumed.messageId;
              }
            } finally {
              stopHb();
            }
          }

          if (!polledFinalAnswer && pollFinalAnswer && conversationId && handoff) {
            const stopHb = startHeartbeat();
            try {
              const polled = await pollFinalAnswer(conversationId);
              if (polled?.text) {
                polledFinalAnswer = polled;
                if (polled.messageId) parentCandidateMessageId = polled.messageId;
              }
            } finally {
              stopHb();
            }
          }

          if (polledFinalAnswer) {
            appendFinalAnswer(polledFinalAnswer.text, polledFinalAnswer.metadata);
          }

          // Async image_gen ends the SSE with a "Processing image..."
          // placeholder; poll the conversation endpoint in the background for
          // the final pointer (only when in-stream pointers are empty).
          if (
            imageGenAsync &&
            conversationId &&
            (!imagePointers || imagePointers.length === 0) &&
            pollAsyncImage
          ) {
            // Tell the user something is happening — long polls otherwise
            // look like a hang on the client side. The "..." plus a typing
            // cue renders nicely in Open WebUI.
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [
                    {
                      index: 0,
                      delta: { content: "_Generating image…_\n\n" },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                })
              )
            );
            const stopHb = startHeartbeat();
            try {
              const polled = await pollAsyncImage(conversationId);
              if (polled.length > 0) imagePointers = polled;
            } catch (err) {
              log?.warn?.(
                "CGPT-WEB",
                `Async image poll failed: ${err instanceof Error ? err.message : String(err)}`
              );
            } finally {
              stopHb();
            }
          }

          // Resolve and append any image markdown after the text deltas finish
          // streaming. Downloading and caching the image bytes can take 1-3
          // seconds for big images, so keep the heartbeat running here too.
          const stopHb2 = startHeartbeat();
          let urls = [];
          try {
            urls = await resolveImagePointers(
              imagePointers,
              conversationId,
              resolver,
              log,
              parentCandidateMessageId
            );
          } finally {
            stopHb2();
          }
          // Bail out cleanly if the client disconnected during the wait —
          // any further enqueue throws "Invalid state: Controller is
          // already closed". Better to no-op than to surface that as a
          // server error.
          if (signal?.aborted) return;
          const mdBlock = imageMarkdown(urls);
          const safeEnqueue = (bytes) => {
            try {
              controller.enqueue(bytes);
              return true;
            } catch {
              console.warn("[chatgpt-web] controller enqueue failed");
              return false;
            }
          };
          // The image markdown is now a small URL (we cache the bytes in
          // memory and serve them at /v1/chatgpt-web/image/<id>), so a
          // single SSE chunk is fine — no aiohttp LineTooLong concerns
          // and the markdown renderer in Open WebUI sees the URL whole
          // and renders an `<img>` immediately.
          if (mdBlock) {
            if (
              !safeEnqueue(
                encoder.encode(
                  sseChunk({
                    id: cid,
                    object: "chat.completion.chunk",
                    created,
                    model,
                    system_fingerprint: null,
                    choices: [
                      {
                        index: 0,
                        delta: { content: mdBlock },
                        finish_reason: null,
                        logprobs: null,
                      },
                    ],
                  })
                )
              )
            )
              return;
          }

          if (
            !safeEnqueue(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
                })
              )
            )
          )
            return;
          safeEnqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: cid,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: `[Stream error: ${err instanceof Error ? err.message : String(err)}]`,
                    },
                    finish_reason: "stop",
                    logprobs: null,
                  },
                ],
              })
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          try {
            controller.close();
          } catch {}
        }
      },
    },
    { highWaterMark: 16384 }
  );
}


async function buildNonStreamingResponse(
  eventStream,
  model,
  cid,
  created,
  currentMsg,
  resolver,
  pollAsyncImage,
  resumeFinalAnswer,
  pollFinalAnswer,
  log,
  signal
) {
  let fullAnswer = "";
  let conversationId = null;
  let imagePointers;
  let imageGenAsync = false;
  let handoff = false;
  let resumeToken = null;
  let answerMetadata;
  let parentCandidateMessageId = null;

  for await (const chunk of extractContent(eventStream, signal)) {
    if (chunk.conversationId) conversationId = chunk.conversationId;
    if (chunk.messageId) parentCandidateMessageId = chunk.messageId;
    if (chunk.handoff) handoff = true;
    if (chunk.resumeToken) resumeToken = chunk.resumeToken;
    if (chunk.error) {
      return new Response(
        JSON.stringify({
          error: { message: chunk.error, type: "upstream_error", code: "CHATGPT_ERROR" },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    if (chunk.done) {
      fullAnswer = chunk.answer || fullAnswer;
      answerMetadata = chunk.metadata ?? answerMetadata;
      imagePointers = chunk.imagePointers;
      imageGenAsync = chunk.imageGenAsync ?? false;
      handoff = handoff || (chunk.handoff ?? false);
      if (chunk.resumeToken) resumeToken = chunk.resumeToken;
      if (chunk.messageId) parentCandidateMessageId = chunk.messageId;
      break;
    }
    if (chunk.answer) {
      fullAnswer = chunk.answer;
      answerMetadata = chunk.metadata ?? answerMetadata;
    }
  }

  let resumedAnswer = null;
  if (resumeFinalAnswer && conversationId && handoff && resumeToken) {
    resumedAnswer = await resumeFinalAnswer(conversationId, resumeToken);
    if (resumedAnswer?.text) {
      fullAnswer = resumedAnswer.text;
      answerMetadata = resumedAnswer.metadata ?? answerMetadata;
      if (resumedAnswer.messageId) parentCandidateMessageId = resumedAnswer.messageId;
    }
  }

  if (
    !resumedAnswer?.text &&
    pollFinalAnswer &&
    conversationId &&
    (handoff || !fullAnswer.trim())
  ) {
    const polled = await pollFinalAnswer(conversationId);
    if (polled?.text) {
      fullAnswer = polled.text;
      answerMetadata = polled.metadata ?? answerMetadata;
      if (polled.messageId) parentCandidateMessageId = polled.messageId;
    }
  }

  fullAnswer = cleanChatGptText(fullAnswer, answerMetadata);

  // Async image gen: SSE ended with "Processing image..." — poll for the
  // final pointer the same way the streaming path does.
  if (
    imageGenAsync &&
    conversationId &&
    (!imagePointers || imagePointers.length === 0) &&
    pollAsyncImage
  ) {
    try {
      const polled = await pollAsyncImage(conversationId);
      if (polled.length > 0) imagePointers = polled;
    } catch (err) {
      log?.warn?.(
        "CGPT-WEB",
        `Async image poll failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const urls = await resolveImagePointers(
    imagePointers,
    conversationId,
    resolver,
    log,
    parentCandidateMessageId
  );
  // The image genuinely exists upstream but no pointer resolved to a URL
  // (unknown asset scheme, download 403/expired, oversize). Flag it so the
  // image-generation handler can report an accurate "generated but not
  // retrievable" error instead of the misleading "no image markdown" 502.
  const imageResolutionFailed = detectImageResolutionFailure(
    imagePointers?.length ?? 0,
    urls.length
  );
  if (imageResolutionFailed && log?.warn) {
    const schemes = (imagePointers ?? [])
      .map((p) => p.pointer.split("://")[0] || p.pointer.slice(0, 24))
      .join(", ");
    log.warn(
      "CGPT-WEB",
      `Image generated upstream but no asset pointer resolved (schemes: ${schemes}) — surfacing as unretrievable`
    );
  }
  fullAnswer += imageMarkdown(urls);
  const promptTokens = Math.ceil(currentMsg.length / 4);
  const completionTokens = Math.ceil(fullAnswer.length / 4);

  const completion = {
      id: cid,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: fullAnswer },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
  };
  if (imageResolutionFailed) completion.x_image_resolution_failed = true;
  return new Response(JSON.stringify(completion), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}


function commonPrefixLength(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}


function stringToStream(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

export { buildStreamingResponse, buildNonStreamingResponse, stringToStream, detectImageResolutionFailure };
