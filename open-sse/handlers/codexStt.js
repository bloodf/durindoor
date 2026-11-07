// Codex OAuth transcription (ported from upstream 9router 421f2262).
// Unverified: ChatGPT's internal /backend-api/transcribe endpoint was never called from here.
import https from "node:https";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import codex from "../providers/registry/codex.js";
import { resolveCodexAccountId } from "../shared/codexAccountId.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { convertAudio, readBounded, MAX_AUDIO_BYTES } from "./codexSttAudio.js";
import { createErrorResult } from "../utils/error.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const MAX_CONCURRENT = 2;
const UPSTREAM_TIMEOUT_MS = 60000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TEXT_CHARS = 250000;
const ALLOWED_FIELDS = ["model", "file", "response_format", "language", "prompt", "temperature"];
let active = 0;

const failure = (status, message) => Object.assign(new Error(message), { status });
const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

// Keep the signal connected until the response body finishes, not just the headers.
export function codexHttpFetch(url, { headers, body, signal }) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const req = https.request(url, { method: "POST", headers, signal }, (res) => {
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const abort = () => res.destroy(signal.reason || new Error("Aborted"));
      signal?.addEventListener("abort", abort, { once: true });
      res.once("close", cleanup);
      res.once("end", cleanup);
      if (signal?.aborted) abort();
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value != null) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      }
      const status = res.statusCode || 502;
      if ([204, 205, 304].includes(status)) {
        res.resume();
        resolve(new Response(null, { status, headers: responseHeaders }));
      } else {
        resolve(new Response(Readable.toWeb(res), { status, headers: responseHeaders }));
      }
    });
    req.once("error", reject);
    req.end(body);
  });
}

/**
 * Errors raised before the upstream call (validation, ffmpeg, capacity) are flagged
 * `local` so the caller never cools down or rotates a healthy account for them.
 */
const localError = (status, message) => ({ ...createErrorResult(status, message), local: true });

export async function transcribeCodex({ formData, credentials, signal: clientSignal, proxyOptions = resolveCredentialProxyOptions(credentials) }) {
  let slot = false;
  let upstreamStarted = false;
  const signal = AbortSignal.any([...(clientSignal ? [clientSignal] : []), AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);
  try {
    const account = credentials?.providerSpecificData || {};
    const accountId = resolveCodexAccountId(account, credentials?.idToken);
    if (credentials?.authType !== "oauth" || !isString(credentials.accessToken) || !/^[\x21-\x7e]+$/.test(credentials.accessToken) ||
    !isString(accountId) || !/^[\x21-\x7e]{1,256}$/.test(accountId)) {
      return createErrorResult(401, "A valid Codex OAuth account is required");
    }
    for (const [key] of formData) {
      if (!ALLOWED_FIELDS.includes(key) || formData.getAll(key).length !== 1) throw failure(400, "Unsupported or duplicate form field");
    }
    const format = formData.get("response_format") || "json";
    if (!["json", "text"].includes(format)) throw failure(400, "Only json and text response formats are supported");
    for (const key of ["language", "prompt", "temperature"]) {
      if (formData.has(key) && formData.get(key) !== "") throw failure(400, `${key} is not supported by Codex transcription`);
    }
    const file = formData.get("file");
    if (!(file instanceof Blob) || !file.size) throw failure(400, "A non-empty audio file is required");
    if (file.size > MAX_AUDIO_BYTES) throw failure(413, "Audio exceeds 25 MiB");
    if (proxyOptions?.source === "error") throw failure(503, "Account proxy is unavailable");
    if (active >= MAX_CONCURRENT) throw failure(503, "Transcription capacity reached");
    active++;slot = true;
    signal.throwIfAborted();
    const { audio, seconds } = await convertAudio(file, signal);
    const boundary = `----durindoor-codex-${randomUUID()}`;
    const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
    Buffer.from(await audio.arrayBuffer()), Buffer.from(`\r\n--${boundary}--\r\n`)]
    );
    upstreamStarted = true;
    const response = await proxyAwareFetch(codex.sttConfig.baseUrl, {
      method: "POST", redirect: "error", signal, body, directFetch: codexHttpFetch,
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`, "ChatGPT-Account-Id": accountId,
        "User-Agent": codex.transport.headers["User-Agent"],
        "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(body.length)
      }
    }, proxyOptions);
    if (!response.ok) {
      await response.body?.cancel();
      return createErrorResult(response.status >= 400 && response.status <= 599 ? response.status : 502, "Codex transcription failed");
    }
    const bytes = await readBounded(response.body, MAX_RESPONSE_BYTES, signal, 502);
    let data;
    try {data = JSON.parse(bytes.toString("utf8"));} catch {throw failure(502, "Invalid transcription response");}
    if (!isString(data?.text) || data.text.length > MAX_TEXT_CHARS) throw failure(502, "Invalid transcription response");
    return {
      success: true,
      // Decoded duration is measured by ffmpeg; the ChatGPT endpoint reports no usage or cost.
      nativeUnits: { audioSeconds: seconds },
      response: format === "text" ?
      new Response(data.text, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } }) :
      Response.json({ text: data.text }, { headers: cors })
    };
  } catch (error) {
    const status = error.status || (signal.aborted ? 504 : 502);
    const message = error.status ? error.message : "Codex transcription failed";
    // Only pre-upstream failures and local conversion limits are the caller's, not the account's.
    return !upstreamStarted && error.status ? localError(status, message) : createErrorResult(status, message);
  } finally {
    if (slot) active--;
  }
}
