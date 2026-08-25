import {
  finishTrace as finishTraceRepo,
  record as recordRepo,
  startTrace as startTraceRepo,
} from "@/lib/db/repos/proxyTimelineRepo.js";
import { createClientFrameFramer } from "./proxyTimelineFrame.js";

export const startTrace = (...args) => startTraceRepo(...args);
export const record = (traceId, event) => recordRepo(traceId, event);
export const finishTrace = (traceId, fields) => finishTraceRepo(traceId, fields);

export function attachClientFrameTap(traceId, format) {
  const framer = createClientFrameFramer({
    format,
    onFrame: (payload) => record(traceId, { type: "sse_chunk", direction: "out", payload }),
  });
  return {
    onClientBytes(chunk) { try { framer.push(chunk); } catch {} },
    onClientEnd() { try { framer.flush(); } catch {} },
    onClientAbort() { try { framer.flush(); } catch {} },
  };
}
