// NVIDIA NIM image generation adapter
import { nowSec } from "./_base.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";

const CLOUD_BASE_URL = "https://ai.api.nvidia.com/v1/genai";

function parseSize(size) {
  if (!size || size === "auto" || !isString(size)) return null;
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function numberFromInput(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseDimensions(body) {
  const width = numberFromInput(body.width);
  const height = numberFromInput(body.height);
  if (width !== null && height !== null) return { width, height };
  return parseSize(body.size);
}

function copyIfPresent(target, source, key) {
  if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
    target[key] = source[key];
  }
}

function copyNumberIfPresent(target, source, key, options = {}) {
  if (source[key] === undefined || source[key] === null || source[key] === "") return;
  const value = Number(source[key]);
  if (!Number.isFinite(value)) return;
  if (options.greaterThan !== undefined && !(value > options.greaterThan)) return;
  target[key] = value;
}

function normalizeImageArray(image) {
  if (Array.isArray(image)) return image.filter(Boolean);
  return image ? [image] : [];
}

function isFlux1DevDimension(value) {
  return Number.isInteger(value) && value >= 768 && value <= 1344 && value % 64 === 0;
}

function buildFluxBody(model, body) {
  const req = { prompt: body.prompt };
  const dimensions = parseDimensions(body);
  if (dimensions && model !== "black-forest-labs/flux.1-kontext-dev") {
    if (model !== "black-forest-labs/flux.1-dev" || (isFlux1DevDimension(dimensions.width) && isFlux1DevDimension(dimensions.height))) {
      req.width = dimensions.width;
      req.height = dimensions.height;
    }
  }

  if (model === "black-forest-labs/flux.1-dev") {
    const mode = body.mode || "base";
    req.mode = mode;
    if (mode !== "base") {
      const images = normalizeImageArray(body.image);
      if (images.length > 0) req.image = images[0];
    }
  } else if (model === "black-forest-labs/flux.1-kontext-dev") {
    const images = normalizeImageArray(body.image);
    if (images.length > 0) req.image = images[0];
    copyIfPresent(req, body, "aspect_ratio");
  } else if (body.image) {
    req.image = normalizeImageArray(body.image);
  }

  if (model === "black-forest-labs/flux.1-dev") {
    copyNumberIfPresent(req, body, "cfg_scale", { greaterThan: 1 });
  } else {
    copyIfPresent(req, body, "cfg_scale");
  }
  copyIfPresent(req, body, "seed");
  copyIfPresent(req, body, "steps");
  return req;
}

function imageItemFromValue(value) {
  if (!value) return null;
  if (isString(value)) return { b64_json: value };
  if (value.url) return { url: value.url };
  const base64 = value.base64 || value.b64_json || value.image || value.data;
  if (!base64) return null;
  const item = { b64_json: base64 };
  if (value.finishReason || value.finish_reason) {
    item.finish_reason = value.finishReason || value.finish_reason;
  }
  return item;
}

export default {
  buildUrl: (model) => {
    if (!/^black-forest-labs\/flux\.(?:2-klein-4b|1-dev|1-schnell|1-kontext-dev)$/.test(model)) {
      throw new Error("Unsupported NVIDIA image model");
    }
    return `${CLOUD_BASE_URL}/${model}`;
  },
  buildHeaders: (creds) => {
    const key = creds?.apiKey || creds?.accessToken;
    const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
    };
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },
  buildBody: (model, body) => {
    if (model === "black-forest-labs/flux.1-kontext-dev" && !body.image) {
      throw new Error("NVIDIA FLUX.1 Kontext Dev requires an input image");
    }
    return buildFluxBody(model, body);
  },
  normalize: (responseBody) => {
    if (responseBody?.created && Array.isArray(responseBody.data)) return responseBody;

    const candidates = [];
    if (Array.isArray(responseBody?.artifacts)) candidates.push(...responseBody.artifacts);
    if (Array.isArray(responseBody?.images)) candidates.push(...responseBody.images);
    if (Array.isArray(responseBody?.data)) candidates.push(...responseBody.data);
    if (responseBody?.artifact) candidates.push(responseBody.artifact);
    if (responseBody?.image) candidates.push(responseBody.image);
    if (responseBody?.base64) candidates.push(responseBody.base64);
    if (responseBody?.result?.image) candidates.push(responseBody.result.image);
    if (Array.isArray(responseBody?.result?.artifacts)) candidates.push(...responseBody.result.artifacts);

    return {
      created: nowSec(),
      data: candidates.map(imageItemFromValue).filter(Boolean),
    };
  },
};
