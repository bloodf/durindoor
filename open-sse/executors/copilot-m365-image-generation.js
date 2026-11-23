/**
 * Image generation through a Microsoft 365 Copilot connection: one chat turn with the web client's
 * image options, then the generated artifacts downloaded with a Designer token.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/executors/m365ImageGeneration.ts`
 * and `open-sse/executors/m365Protocol/imageGeneration.ts` at 5ffa68e835442a12ed1204a2eebf4076c298aecb.
 *
 * Copilot draws with a built-in server-side tool. A turn opts in with the image option sets and
 * declares that it can receive `GenerateGraphicArt` messages. The picture never arrives as chat text:
 * a bot message carries a `contentGenerationProgressList` entry per image, repeated until `status` 2
 * (ready), whose `ImageReferenceUrls` point at an artifact on the Designer service. The artifact
 * refuses the chat token; it needs a token for `M365_IMAGE_ARTIFACT_SCOPE`, minted from the
 * connection's refresh token. Only a native sign-in connection has one.
 */
import { M365_IMAGE_ARTIFACT_SCOPE } from "../config/copilotM365.js";
import { mintM365ScopedToken } from "../services/tokenRefresh/copilotM365.js";
import { credentialFetch } from "../utils/credentialFetch.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { detectImageMime } from "../translator/concerns/image.js";
import { isNumber, isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { buildWsUrl, resolveConnectionParams } from "./copilot-m365-connection.js";
import { ALLOWED_MESSAGE_TYPES, M365_DEFAULT_OPTION_SETS, buildChatInvocation } from "./copilot-m365-frames.js";
import { M365TurnComposer } from "./copilot-m365-composer.js";
import { M365ExecutorError } from "./copilot-m365-output.js";
import { resolveM365Profile } from "./copilot-m365-profile.js";
import { runM365Socket } from "./copilot-m365-web.js";

/** The image option sets the web client sends on every turn; the model picks the kind. */
export const M365_IMAGE_OPTION_SETS = Object.freeze([
"cwc_flux_image",
"cwc_flux_v3",
"enable_gg_gpt",
"flux_v3_progress_messages",
"flux_v3_image_gen_enable_dimensions",
"flux_v3_image_gen_enable_icon_dimensions",
"flux_v3_image_gen_enable_story",
"flux_v3_image_gen_enable_designer_dimensions_meta_prompting_in_system_prompts",
"flux_v3_image_gen_enable_system_text_with_params",
"flux_v3_image_gen_enable_non_watermarked_storage"]
);

/** The message type a turn must declare to receive generated images. */
export const M365_GRAPHIC_ART_MESSAGE_TYPE = "GenerateGraphicArt";

/** The model image generation runs under: Copilot's default routing, as the web client does. */
const IMAGE_MODEL = "m365-copilot";
/** Artifacts are served from this host only; the Designer token is never sent elsewhere. */
const ARTIFACT_HOST = "designerapp.officeapps.live.com";
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const ARTIFACT_TIMEOUT_MS = 60_000;
/** Reuse a Designer token until this long before it expires. */
const ARTIFACT_TOKEN_MARGIN_MS = 5 * 60_000;
const MAX_IMAGES = 10;

const artifactTokens = new Map();

/** Forget cached Designer tokens (tests). */
export function __resetM365ArtifactTokensForTesting() {
  artifactTokens.clear();
}

/** Whether `url` is a Designer artifact URL, the only place the Designer token may go. */
export function isM365ArtifactUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === ARTIFACT_HOST && !parsed.port &&
    !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** The bot messages a frame carries: streamed updates and the final item. */
function frameMessages(frame) {
  if (!isRecord(frame)) return [];
  if (frame.type === 2) {
    const item = Array.isArray(frame.item) ? frame.item[0] : frame.item;
    const messages = isRecord(item) ? item.messages : undefined;
    return Array.isArray(messages) ? messages : [];
  }
  if (frame.type === 1 && Array.isArray(frame.arguments)) {
    return frame.arguments.flatMap((argument) => isRecord(argument) && Array.isArray(argument.messages) ? argument.messages : []);
  }
  return [];
}

/**
 * Collects the images a turn generates. The same image is announced repeatedly while it renders, so
 * entries are keyed by file token (or first URL) and the readiest copy wins.
 */
export class M365GeneratedImageCollector {
  #byKey = new Map();

  push(frame) {
    for (const message of frameMessages(frame)) {
      const list = isRecord(message) ? message.contentGenerationProgressList : undefined;
      if (!Array.isArray(list)) continue;
      for (const raw of list) if (isRecord(raw)) this.#add(raw);
    }
  }

  #add(entry) {
    const urls = Array.isArray(entry.ImageReferenceUrls) ? entry.ImageReferenceUrls : [];
    const url = urls.find((value) => isString(value) && value);
    if (!url) return;
    const key = isString(entry.fileToken) && entry.fileToken ? entry.fileToken : url;
    const status = isNumber(entry.status) ? entry.status : 0;
    const previous = this.#byKey.get(key);
    if (previous && previous.status >= status) return;
    if (!previous && this.#byKey.size >= MAX_IMAGES) return;
    this.#byKey.set(key, { url, status });
  }

  /** The images announced so far, in first-seen order. */
  get images() {
    return [...this.#byKey.values()];
  }
}

/**
 * Classify a turn that produced no image from its text. Only meaningful without images: then the
 * text is a status or a refusal, not a caption. Unknown wordings fall back to `no_image`.
 */
export function classifyM365ImageFailure(text) {
  const t = String(text || "").toLowerCase();
  if (/can.?t generate any more images|no more images (today|right now)|reached (your|the)[^.]*image|image (generation )?(limit|quota)|try again tomorrow/.test(t)) {
    return "quota_exceeded";
  }
  if (/trouble (creating|generating|making)[^.]*image|couldn.?t (create|generate)[^.]*image|try again (later|in a (bit|moment|few))/.test(t)) {
    return "capacity";
  }
  if (/can.?t (create|generate|make) (that|this|an? )[^.]*image|unable to (create|generate)[^.]*image|against[^.]*(policy|guideline)|can.?t help (with|create) that/.test(t)) {
    return "content_filtered";
  }
  return "no_image";
}

/** The orientation an OpenAI `size` (`WIDTHxHEIGHT`) asks for, or null when it names none. */
export function m365OrientationForSize(size) {
  const match = isString(size) ? /^(\d+)x(\d+)$/.exec(size.trim()) : null;
  if (!match) return null;
  const [width, height] = [Number(match[1]), Number(match[2])];
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

/** The prompt for an image turn: the caller's text, plus the orientation as an instruction. */
export function m365ImagePrompt(prompt, orientation) {
  const directive = {
    landscape: "Use a landscape (wide, 16:9) orientation.",
    portrait: "Use a portrait (tall, 9:16) orientation.",
    square: "Use a square (1:1) orientation."
  };
  return orientation ? `${prompt.trim()}\n\n${directive[orientation]}` : prompt;
}

/** The no-image outcome of a turn, as a public error. */
function noImageError(text) {
  switch (classifyM365ImageFailure(text)) {
    case "quota_exceeded":
      return new M365ExecutorError(429, "m365_image_quota_exceeded",
      "Microsoft 365 Copilot's image budget for this account is used up. Try again tomorrow.");
    case "capacity":
      return new M365ExecutorError(503, "m365_image_capacity", "Microsoft 365 Copilot could not generate an image right now. Retry later.");
    case "content_filtered":
      return new M365ExecutorError(400, "m365_image_refused", "Microsoft 365 Copilot declined to generate this image.");
    default:
      return new M365ExecutorError(502, "m365_image_not_generated", "Microsoft 365 Copilot answered without generating an image.");
  }
}

/** The connection's refresh token; image generation needs one to mint the Designer token. */
function requireRefreshToken(credentials) {
  const refreshToken = credentials?.refreshToken;
  if (isString(refreshToken) && refreshToken) return refreshToken;
  throw new M365ExecutorError(400, "m365_image_requires_sign_in",
  "Microsoft 365 Copilot image generation needs a native sign-in connection, not a pasted session.");
}

/** Run one image turn and return the images it announced. */
async function runImageTurn(request) {
  const params = resolveConnectionParams(request.credentials);
  if ("error" in params) throw new M365ExecutorError(params.expired ? 401 : 400, "invalid_credentials", params.error);
  const psd = isRecord(request.credentials?.providerSpecificData) ? request.credentials.providerSpecificData : {};
  const field = (key) => isString(psd[key]) && psd[key] ? psd[key] : undefined;
  const profile = resolveM365Profile({
    model: IMAGE_MODEL,
    tier: params.tier,
    scenario: field("scenario"),
    licenseType: field("licenseType"),
    agent: field("agent")
  });
  // Image turns are always temporary chats: they never land in the account's history.
  const url = new URL(buildWsUrl({ ...params, ...profile, disableMemory: true }));
  const invocation = buildChatInvocation({
    text: m365ImagePrompt(request.prompt, request.orientation),
    traceId: url.searchParams.get("clientrequestid"),
    sessionId: url.searchParams.get("X-SessionId"),
    requestId: url.searchParams.get("chatsessionid"),
    conversationId: url.searchParams.get("ConversationId"),
    isStartOfSession: true,
    tone: profile.tone,
    optionsSets: [...new Set([...M365_DEFAULT_OPTION_SETS, ...M365_IMAGE_OPTION_SETS])],
    allowedMessageTypes: [...ALLOWED_MESSAGE_TYPES, M365_GRAPHIC_ART_MESSAGE_TYPE]
  });
  const composer = new M365TurnComposer();
  const images = new M365GeneratedImageCollector();
  await runM365Socket({
    wsUrl: url.toString(),
    proxyOptions: request.proxyOptions,
    invocation,
    signal: request.signal,
    onFrame(frame) {
      composer.push(frame);
      images.push(frame);
    }
  });
  if (!images.images.length) throw noImageError(composer.text);
  return images.images;
}

/**
 * A Designer token for this connection, minted from its stored refresh token and cached until
 * shortly before it expires. A rotated refresh token is persisted like any other refresh.
 */
async function artifactToken(request) {
  const { credentials } = request;
  const refreshToken = requireRefreshToken(credentials);
  const key = isString(credentials.connectionId) && credentials.connectionId ? credentials.connectionId : null;
  const cached = key ? artifactTokens.get(key) : undefined;
  if (cached && cached.expiresAt - ARTIFACT_TOKEN_MARGIN_MS > Date.now()) return cached.token;
  const result = await mintM365ScopedToken(credentials, M365_IMAGE_ARTIFACT_SCOPE, {
    signal: request.signal,
    proxyOptions: request.proxyOptions,
    log: request.log
  });
  if (!result || "error" in result) {
    throw new M365ExecutorError(401, "m365_image_token_failed",
    "Microsoft 365 Copilot refused the image download credentials. Reconnect this account.");
  }
  if (result.refreshToken && result.refreshToken !== refreshToken) {
    credentials.refreshToken = result.refreshToken;
    await request.onCredentialsRefreshed?.({
      accessToken: credentials.accessToken,
      refreshToken: result.refreshToken,
      providerSpecificData: credentials.providerSpecificData
    });
  }
  if (key) artifactTokens.set(key, { token: result.accessToken, expiresAt: Date.now() + (result.expiresIn ?? 3600) * 1000 });
  return result.accessToken;
}

/** Read a response body, refusing more than `limit` bytes. */
async function readBounded(response, limit) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("artifact too large");
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error("artifact too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Download one artifact with the Designer token. Only Designer artifact URLs are fetched, and a
 * redirect off the artifact origin is refused (`credentialFetch`), so the token never leaves it.
 */
async function downloadArtifact(image, token, request) {
  const failed = () => new M365ExecutorError(502, "m365_image_download_failed",
  "Microsoft 365 Copilot generated an image that could not be downloaded.");
  if (!isM365ArtifactUrl(image.url)) throw failed();
  const timeout = AbortSignal.timeout(ARTIFACT_TIMEOUT_MS);
  try {
    const response = await credentialFetch(
      (url, init) => proxyAwareFetch(url, init, request.proxyOptions),
      image.url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
      }
    );
    if (!response.ok) {
      await response.body?.cancel?.().catch?.(() => {});
      throw failed();
    }
    const data = await readBounded(response, MAX_ARTIFACT_BYTES);
    const mime = detectImageMime(data);
    if (!mime) throw failed();
    return { data, contentType: mime };
  } catch (error) {
    if (request.signal?.aborted) throw error;
    throw error instanceof M365ExecutorError ? error : failed();
  }
}

/**
 * Generate images for a prompt with one Copilot turn and download them. Fails with a typed public
 * error when the turn draws nothing (budget used up, capacity, refusal, or no image).
 *
 * @param {object} request `{ credentials, prompt, orientation, signal, proxyOptions, log, onCredentialsRefreshed }`
 * @returns {Promise<Array<{ data: Buffer, contentType: string }>>}
 */
export async function generateM365Images(request) {
  // Checked before the turn: a turn spends the account's small image budget, and its artifacts
  // could not be downloaded without a refresh token to mint the Designer token from.
  requireRefreshToken(request.credentials);
  const refs = await runImageTurn(request);
  const token = await artifactToken(request);
  const images = [];
  for (const ref of refs) images.push(await downloadArtifact(ref, token, request));
  return images;
}
