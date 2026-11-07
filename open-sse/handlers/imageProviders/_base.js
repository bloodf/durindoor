// Shared helpers for image provider adapters
import { isString } from "../../../src/shared/utils/typeChecks.js";
import { MAX_IMAGE_BYTES } from "../../config/mediaConfig.js";

export const POLL_INTERVAL_MS = 1500;
export const POLL_TIMEOUT_MS = 120000;

// Abortable: rejects with the signal's reason as soon as it aborts, so polling loops stop.
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

// The provider accepted this job, but its outcome can no longer be observed. It may
// still bill, so the core records it as accepted with unknown cost (#1085).
export const jobOutcomeUnknown = (message, status) =>
  Object.assign(new Error(message), { jobOutcomeUnknown: true }, status ? { status } : null);

// One status check for an accepted job. An abort stays an abort; anything else
// that loses sight of the job is a lost observation, not a reported job failure.
export async function fetchJobStatus(url, init, label) {
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (init?.signal?.aborted || error?.name === "AbortError") throw error;
    throw jobOutcomeUnknown(`${label} status check failed: ${error?.message || error}`);
  }
  if (!response.ok) throw jobOutcomeUnknown(`${label} status ${response.status}`);
  return response;
}

// Read an accepted job's status or result body. An abort stays an abort; an unreadable
// body loses sight of the job, so it is a lost observation, not a reported failure.
export async function readJobBody(read, signal) {
  try {
    return await read();
  } catch (error) {
    if (error?.jobOutcomeUnknown || signal?.aborted || error?.name === "AbortError") throw error;
    throw jobOutcomeUnknown(error?.message || String(error));
  }
}

// Map OpenAI size to provider-specific aspect ratio
export function sizeToAspectRatio(size) {
  if (!size || !isString(size)) return "1:1";
  const map = {
    "1024x1024": "1:1",
    "1024x1792": "9:16",
    "1792x1024": "16:9",
    "1024x1536": "2:3",
    "1536x1024": "3:2"
  };
  return map[size] || "1:1";
}

// Fetch URL → base64 (for providers returning image URLs)
export async function urlToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function decodedBase64Bytes(data) {
  return Math.floor(data.length * 3 / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

// Convert image input (data URI or raw base64) to Gemini inlineData part.
// Payloads over MAX_IMAGE_BYTES decoded are rejected (null) like other media inputs.
export function resolveImageInput(input) {
  if (!input || !isString(input)) return null;
  // data:image/png;base64,... format
  const dataUriMatch = input.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    if (decodedBase64Bytes(dataUriMatch[2]) > MAX_IMAGE_BYTES) return null;
    return { inlineData: { mimeType: dataUriMatch[1], data: dataUriMatch[2] } };
  }
  // Raw base64 string (assume PNG): full charset only, never URLs or other text
  if (input.length > 100 && BASE64_RE.test(input) && decodedBase64Bytes(input) <= MAX_IMAGE_BYTES) {
    return { inlineData: { mimeType: "image/png", data: input } };
  }
  return null;
}
