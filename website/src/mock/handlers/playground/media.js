// Media and retrieval endpoints used by the media-provider example cards:
// embeddings, rerank, images, audio, video, music, web search and web fetch.

import { reply } from "../../http.js";
import { randomId } from "../../fixtures/playgroundReplies.js";
import { resolveModel } from "../../fixtures/playgroundCatalog.js";
import {
  bytesToBase64,
  embeddingVector,
  fetchedPage,
  gradientPng,
  relevance,
  searchResults,
  silentWav,
} from "../../fixtures/playgroundMedia.js";
import { onBoth, streamFrames } from "./stream.js";

const now = () => Math.floor(Date.now() / 1000);
const invalid = (message) => reply({ error: { message, type: "invalid_request_error" } }, { status: 400 });
const bodyOf = (body) => (body && typeof body === "object" ? body : {});
const named = (event, payload) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

function embeddings({ body }) {
  const request = bodyOf(body);
  if (request.input == null || request.input === "") return invalid("input is required");
  const inputs = Array.isArray(request.input) ? request.input : [request.input];
  const dimensions = Math.min(Math.max(Number(request.dimensions) || 768, 8), 3072);
  const tokens = inputs.reduce((sum, item) => sum + Math.ceil(String(item).length / 4), 0);
  return {
    object: "list",
    data: inputs.map((item, index) => ({ object: "embedding", index, embedding: embeddingVector(String(item), dimensions) })),
    model: request.model || "embedding",
    usage: { prompt_tokens: tokens, total_tokens: tokens },
  };
}

function rerank({ body }) {
  const request = bodyOf(body);
  const documents = Array.isArray(request.documents) ? request.documents : [];
  if (!request.query || documents.length === 0) return invalid("query and documents are required");
  const results = documents
    .map((document, index) => {
      const text = typeof document === "string" ? document : document?.text || JSON.stringify(document);
      return { index, relevance_score: relevance(request.query, text), document: { text } };
    })
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, Number(request.top_n) || documents.length);
  return { id: randomId("rerank-"), model: request.model || "rerank", results, usage: { search_units: 1 } };
}

function imageGenerations({ body, query, signal }) {
  const request = bodyOf(body);
  if (!request.prompt) return invalid("prompt is required");
  const count = Math.min(Math.max(Number(request.n) || 1, 1), 4);
  const images = Array.from({ length: count }, (_, index) => gradientPng(`${request.prompt}#${index}`));

  if (query.response_format === "binary") {
    return new Response(images[0], { status: 200, headers: { "content-type": "image/png" } });
  }
  const data = images.map((png) => ({ b64_json: bytesToBase64(png), revised_prompt: request.prompt }));
  const payload = { created: now(), data, usage: { input_tokens: Math.ceil(request.prompt.length / 4), output_tokens: 1024 } };

  // Codex image models stream progress events (see GenericExampleCard).
  if (/^(cx|codex)\//.test(String(request.model || ""))) {
    const frames = [
      named("progress", { stage: "queued" }),
      named("progress", { stage: "generating", bytesReceived: 0 }),
      named("partial_image", { b64_json: data[0].b64_json, partial_image_index: 0 }),
      named("progress", { stage: "finalizing", bytesReceived: images[0].length }),
      named("done", payload),
    ];
    return streamFrames(frames, { signal, minMs: 350, maxMs: 700 });
  }
  return payload;
}

function imageUnderstanding({ body }) {
  const request = bodyOf(body);
  if (!request.url && !request.image) return invalid("url or image is required");
  return {
    text: "A tabby cat sits upright facing the camera, with amber eyes and striped grey-brown fur. The background is softly blurred, which keeps the focus on the cat's face and whiskers. Lighting is natural and even, suggesting daylight from a nearby window.",
    model: request.model || "vision",
    usage: { prompt_tokens: 812, completion_tokens: 58, total_tokens: 870 },
  };
}

function speech({ body, query }) {
  const request = bodyOf(body);
  if (!request.input) return invalid("input is required");
  const seconds = Math.min(4, 0.4 + String(request.input).length / 60);
  const wav = silentWav(seconds);
  if (query.response_format === "json") {
    return { audio: bytesToBase64(wav), format: "wav", model: request.model || "tts", duration: Number(seconds.toFixed(2)) };
  }
  return new Response(wav, { status: 200, headers: { "content-type": "audio/wav" } });
}

const TRANSCRIPT = "Hello from Erebor. This is a short test recording to check that speech to text is routed through the gateway correctly.";

function transcription({ body }) {
  const request = bodyOf(body);
  if (!request.file) return invalid("file is required");
  const format = request.response_format || "json";
  if (format === "text") return reply(TRANSCRIPT, { contentType: "text/plain" });
  if (format === "srt") return reply(`1\n00:00:00,000 --> 00:00:04,200\n${TRANSCRIPT}\n`, { contentType: "text/plain" });
  if (format === "vtt") return reply(`WEBVTT\n\n00:00:00.000 --> 00:00:04.200\n${TRANSCRIPT}\n`, { contentType: "text/vtt" });
  if (format === "verbose_json") {
    return { task: "transcribe", language: request.language || "english", duration: 4.2, text: TRANSCRIPT, segments: [{ id: 0, start: 0, end: 4.2, text: TRANSCRIPT }] };
  }
  return { text: TRANSCRIPT };
}

function video({ body }) {
  const request = bodyOf(body);
  if (!request.prompt) return invalid("prompt is required");
  const id = randomId("video_", 16);
  return { id, object: "video.generation", created: now(), status: "completed", model: request.model || "video", data: [{ url: `https://cdn.durindoor.dev/demo/${id}.mp4`, duration_seconds: 5 }] };
}

function music({ body }) {
  const request = bodyOf(body);
  if (!request.prompt) return invalid("prompt is required");
  const { provider } = resolveModel(request.model);
  const id = randomId("clip_", 16);
  return {
    object: "music.generation",
    provider,
    model: request.model || "music",
    status: "completed",
    data: [{ id, title: String(request.prompt).slice(0, 48), audio_url: `data:audio/wav;base64,${bytesToBase64(silentWav(1.5))}`, image_url: null, format: "wav" }],
  };
}

function search({ body }) {
  const request = bodyOf(body);
  if (!request.query) return invalid("query is required");
  const provider = String(request.model || request.provider || "tavily").split("/")[0];
  const results = searchResults(request.query, request.max_results, provider);
  return {
    provider,
    query: request.query,
    results,
    answer: null,
    usage: { queries_used: 1, search_cost_usd: 0.008 },
    metrics: { response_time_ms: 412, upstream_latency_ms: 388, total_results_available: 1840 },
    errors: [],
  };
}

function webFetch({ body }) {
  const request = bodyOf(body);
  if (!request.url) return invalid("url is required");
  const format = request.format || "markdown";
  const { title, text: full } = fetchedPage(request.url, format);
  const max = Number(request.max_characters) || 0;
  const text = max > 0 ? full.slice(0, max) : full;
  return {
    provider: String(request.model || request.provider || "jina").split("/")[0],
    url: request.url,
    title,
    content: { format, text, length: text.length },
    metadata: { author: null, published_at: null, language: "en" },
    usage: { fetch_cost_usd: 0 },
    metrics: { response_time_ms: 640, upstream_latency_ms: 602 },
  };
}

export default function registerMedia(router) {
  onBoth(router, "post", "/embeddings", embeddings);
  onBoth(router, "post", "/rerank", rerank);
  onBoth(router, "post", "/images/generations", imageGenerations);
  onBoth(router, "post", "/images/edits", imageGenerations);
  onBoth(router, "post", "/images/understanding", imageUnderstanding);
  onBoth(router, "post", "/audio/speech", speech);
  onBoth(router, "post", "/audio/transcriptions", transcription);
  onBoth(router, "post", "/audio/translations", transcription);
  onBoth(router, "post", "/audio/music", music);
  onBoth(router, "post", "/music/generations", music);
  onBoth(router, "post", "/video/generations", video);
  onBoth(router, "post", "/videos/generations", video);
  onBoth(router, "post", "/search", search);
  onBoth(router, "post", "/web/fetch", webFetch);
}
