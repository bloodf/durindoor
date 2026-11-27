// The frozen realtime bundle with the source's legacy endpoint aliases in
// front of it. Every argument is passed through unchanged except
// `definition`, whose `endpoint_id` is canonicalized first, so
// `wss://fal.run/{endpoint}{path}` matches the source's falRealtimePath
// (OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad,
// open-sse/config/falEndpoint.ts, MIT).
import { connectFalRealtime, falRealtimePath, falRealtimeUrl } from "../native-fal-realtime/index.js";
import { canonicalFalDefinition } from "./endpoint.js";

/** connectFalRealtime with alias normalization of `definition.endpoint_id`. */
export function connectFalRealtimeCanonical(args) {
  return connectFalRealtime({ ...args, definition: canonicalFalDefinition(args?.definition) });
}

/** falRealtimePath with alias normalization. */
export function falRealtimePathCanonical(definition) {
  return falRealtimePath(canonicalFalDefinition(definition));
}

/** falRealtimeUrl with alias normalization. */
export function falRealtimeUrlCanonical(definition) {
  return falRealtimeUrl(canonicalFalDefinition(definition));
}
