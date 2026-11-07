import { isNumber, isObject, isString } from "./typeChecks.js";

// Operator-configured flat USD rates. These are not vendor rate defaults.
// A single unit per exact provider/model prevents accidental double charging.
export const NATIVE_PRICING_UNITS = Object.freeze({
  image: { quantity: "images", modalities: ["image"], integer: true },
  audio_second: { quantity: "audioSeconds", modalities: ["audio", "stt", "tts", "music"] },
  video_second: { quantity: "videoSeconds", modalities: ["video"] },
  video_job: { quantity: "videoJobs", modalities: ["video"], integer: true },
  character: { quantity: "characters", modalities: ["tts"], integer: true },
});

export function isValidNativePricing(value) {
  return value !== null && isObject(value) && !Array.isArray(value) &&
    Object.keys(value).length === 2 && Object.hasOwn(value, "unit") && Object.hasOwn(value, "rate") &&
    isString(value.unit) && Object.hasOwn(NATIVE_PRICING_UNITS, value.unit) && isNumber(value.rate) &&
    Number.isFinite(value.rate) && value.rate >= 0;
}
