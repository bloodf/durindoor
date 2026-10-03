import { PROVIDER_MEDIA } from "../../providers/index.js";

export default {
  buildUrl: () => PROVIDER_MEDIA.together.imageConfig.baseUrl,
  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json" };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  },
  buildBody: (model, body) => {
    const { prompt, n = 1, size = "1024x1024" } = body;
    const match = /^(\d+)x(\d+)$/.exec(String(size));
    if (!match || !Number(match[1]) || !Number(match[2])) throw new Error("Together image size must be WIDTHxHEIGHT with positive integers");
    const request = { model, prompt, n, width: Number(match[1]), height: Number(match[2]) };
    for (const key of ["steps", "image_url", "seed", "negative_prompt", "response_format", "guidance_scale", "output_format", "image_loras", "reference_images", "disable_safety_checker"]) if (body[key] !== undefined) request[key] = body[key];
    return request;
  },
  normalize: (responseBody) => responseBody,
};
