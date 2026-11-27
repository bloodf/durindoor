// The presigned storage half of Leonardo's init-image flow: validate the
// upload ticket Leonardo returned, resolve and pin the storage host to public
// addresses, and POST the pre-encoded S3 form without the Leonardo key.
//
// Source (OmniRoute c71f0065 uploadLeonardoInitImage, see ./config.js): parse
// `uploadInitImage.fields` as JSON, append each field, append `file` (the
// bytes, named "init"), encode the form through `new Response(form)` and POST
// the bytes with only the boundary Content-Type header.
//
// Fork hardening: the URL must be https on the default port, without
// userinfo, and every address its host resolves to must be public
// (src/shared/utils/ssrfGuard isBlockedHost). The connection is pinned to
// those addresses (no second lookup can rebind it), the connected socket's
// peer is checked again, redirects are refused, nothing but Content-Type is
// sent, the call is time bounded and abortable, and no proxy or environment
// proxy carries it. Errors never quote the URL, the fields or the answer.
import { promises as dnsPromises } from "node:dns";
import { isIP } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  LEONARDO_STORAGE_MAX_FIELD_BYTES, LEONARDO_STORAGE_MAX_FIELDS, LEONARDO_STORAGE_MAX_URL_LENGTH,
} from "./config.js";

const INIT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const FIELD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CONTROL_RE = /[\0\r\n]/;

/** A storage-phase failure. `status` is what the client sees; `unsafe` marks a refused destination. */
export const storageError = (message, status = 502, extra = {}) =>
  Object.assign(new Error(message), { status, storagePhase: true, ...extra });
const blocked = () => storageError("Leonardo init-image storage URL was refused", 502, { unsafe: true });

const bracketless = (host) => host.replace(/^\[|\]$/g, "");

/** A public https URL on the default port without userinfo, or throws a refused-destination error. */
export function checkLeonardoStorageUrl(raw) {
  if (!isString(raw) || !raw || raw.length > LEONARDO_STORAGE_MAX_URL_LENGTH || CONTROL_RE.test(raw) || /\s/.test(raw)) throw blocked();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw blocked();
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname || isBlockedHost(url.hostname)) throw blocked();
  url.hash = "";
  return url;
}

/**
 * The upload ticket of an init-image answer: `{ id, url, fields }`, where
 * `fields` is the source's JSON-encoded string of S3 form fields.
 */
export function parseLeonardoUploadTicket(answer) {
  const ticket = isRecord(answer) ? answer.uploadInitImage : undefined;
  if (!isRecord(ticket)) throw storageError("Leonardo init-image answer has no upload ticket");
  const { id } = ticket;
  if (!isString(id) || !INIT_ID_RE.test(id)) throw storageError("Leonardo init-image answer has no usable init image id");
  if (!isString(ticket.fields) || ticket.fields.length > LEONARDO_STORAGE_MAX_FIELDS * LEONARDO_STORAGE_MAX_FIELD_BYTES) {
    throw storageError("Leonardo init-image answer has unusable upload fields");
  }
  let parsed;
  try {
    parsed = JSON.parse(ticket.fields);
  } catch {
    // The parser's message would quote the signed fields.
  }
  if (!isRecord(parsed)) throw storageError("Leonardo init-image answer has unusable upload fields");
  const entries = Object.entries(parsed);
  if (!entries.length || entries.length > LEONARDO_STORAGE_MAX_FIELDS) throw storageError("Leonardo init-image answer has unusable upload fields");
  const fields = [];
  for (const [name, value] of entries) {
    const text = isString(value) || (isNumber(value) && Number.isFinite(value)) || isBoolean(value) ? String(value) : null;
    if (!FIELD_NAME_RE.test(name) || name.toLowerCase() === "file" || text === null
      || text.length > LEONARDO_STORAGE_MAX_FIELD_BYTES || CONTROL_RE.test(text)) {
      throw storageError("Leonardo init-image answer has unusable upload fields");
    }
    fields.push([name, text]);
  }
  return { id, url: checkLeonardoStorageUrl(ticket.url), fields };
}

/** The source form, pre-encoded: `{ body: Uint8Array, contentType }`. */
export async function encodeLeonardoStorageForm(fields, reference) {
  const form = new FormData();
  for (const [name, value] of fields) form.append(name, value);
  form.append("file", new Blob([reference.bytes], { type: reference.mime }), "init");
  const encoded = new Response(form);
  return { body: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get("content-type") || "" };
}

/** Race a promise against the caller's signal and a deadline; the late result is ignored. */
function bounded(promise, { signal, timeoutMs, timeoutMessage }) {
  let timer;
  let onAbort;
  const stop = new Promise((_, rejectWait) => {
    timer = setTimeout(() => rejectWait(storageError(timeoutMessage, 504, { timedOut: true })), Math.max(1, timeoutMs));
    onAbort = () => rejectWait(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  promise.catch(() => {});
  return Promise.race([promise, stop]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  });
}

/**
 * Every address the storage host resolves to, all public, or throws. One
 * lookup only; the result is what the connection is pinned to.
 */
export async function resolveLeonardoStorageHost(hostname, { lookup = dnsPromises.lookup, signal, timeoutMs }) {
  const host = bracketless(hostname.toLowerCase().replace(/\.+$/, ""));
  if (isBlockedHost(host)) throw blocked();
  const family = isIP(host);
  if (family) return [{ address: host, family }];
  let records;
  try {
    records = await bounded(Promise.resolve().then(() => lookup(host, { all: true, verbatim: true })), {
      signal, timeoutMs, timeoutMessage: "Leonardo init-image storage host lookup timed out",
    });
  } catch (error) {
    if (signal?.aborted || error?.timedOut) throw error;
    throw storageError("Leonardo init-image storage host could not be resolved");
  }
  const list = Array.isArray(records) ? records : [];
  if (!list.length) throw storageError("Leonardo init-image storage host could not be resolved");
  return list.map((record) => {
    const address = isRecord(record) && isString(record.address) ? bracketless(record.address) : "";
    const recordFamily = isIP(address);
    if (!recordFamily || isBlockedHost(address)) throw blocked();
    return { address, family: recordFamily };
  });
}

/**
 * A connector that only reaches the pinned public addresses: a lookup that
 * answers from the pin, a refusal of blocked literal hosts, and a check of
 * the connected socket's peer address. `baseConnect` is for tests.
 */
export function createLeonardoStorageConnector(pinned, baseConnect = null) {
  const allowed = new Set(pinned.map((record) => record.address.toLowerCase()));
  const pinnedLookup = (_hostname, options, callback) => {
    if (options?.all) return callback(null, pinned.map(({ address, family }) => ({ address, family })));
    return callback(null, pinned[0].address, pinned[0].family);
  };
  const connect = baseConnect ?? buildConnector({ lookup: pinnedLookup });
  return (options, callback) => {
    const host = bracketless(String(options?.hostname ?? "").toLowerCase());
    if (!host || isBlockedHost(host) || (isIP(host) && !allowed.has(host))) {
      queueMicrotask(() => callback(blocked()));
      return;
    }
    return connect(options, (error, socket) => {
      if (error) return callback(error);
      const peer = bracketless(String(socket?.remoteAddress ?? "").toLowerCase()).replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
      if (!peer || isBlockedHost(peer) || !allowed.has(peer)) {
        socket?.destroy?.();
        return callback(blocked());
      }
      return callback(null, socket);
    });
  };
}

/** A one-call dispatcher bound to the pinned addresses; closed after the upload. */
export function createLeonardoStorageDispatcher(pinned, { baseConnect = null } = {}) {
  return new Agent({ connect: createLeonardoStorageConnector(pinned, baseConnect), pipelining: 0, connections: 1 });
}

const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/**
 * POST the pre-encoded form to the validated storage URL. Resolves when the
 * storage answered 2xx; throws a storage error (never quoting the URL or the
 * answer) or the caller's abort reason otherwise.
 *
 * @param {object} upload
 * @param {URL} upload.url - from parseLeonardoUploadTicket
 * @param {{ body: Uint8Array, contentType: string }} upload.form
 * @param {Function} [upload.storageFetch] - `(url, init)`; init carries the pinned `dispatcher`
 * @param {Function} [upload.lookup] - dns.promises.lookup-compatible, for tests
 */
export async function uploadLeonardoInitImage({ url, form, signal, timeoutMs, dnsTimeoutMs, storageFetch = undiciFetch, lookup, baseConnect }) {
  const started = Date.now();
  const pinned = await resolveLeonardoStorageHost(url.hostname, { lookup, signal, timeoutMs: Math.min(dnsTimeoutMs, timeoutMs) });
  const dispatcher = createLeonardoStorageDispatcher(pinned, { baseConnect });
  const deadline = new AbortController();
  const fetchSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const remaining = Math.max(1, timeoutMs - (Date.now() - started));
  let response;
  try {
    const pending = Promise.resolve().then(() => storageFetch(url.href, {
      method: "POST",
      headers: { "Content-Type": form.contentType },
      body: form.body,
      redirect: "manual",
      dispatcher,
      signal: fetchSignal,
    }));
    try {
      response = await bounded(pending, { signal, timeoutMs: remaining, timeoutMessage: "Leonardo init-image upload timed out" });
    } catch (error) {
      deadline.abort(error);
      pending.then(discard, () => {});
      throw error;
    }
  } catch (error) {
    if (signal?.aborted || error?.timedOut) throw error;
    if (error?.unsafe || error?.cause?.unsafe) throw blocked();
    throw storageError("Leonardo init-image upload failed to connect");
  } finally {
    // One connection per edit; nothing is pooled across calls or accounts.
    queueMicrotask(() => dispatcher.destroy().catch(() => {}));
  }
  const status = Number(response?.status);
  discard(response);
  if (response?.type === "opaqueredirect" || (status >= 300 && status < 400)) {
    throw storageError("Leonardo init-image upload redirect refused");
  }
  if (!(status >= 200 && status < 300)) throw storageError(`Leonardo init-image upload failed with ${Number.isInteger(status) ? status : "an invalid status"}`);
}
