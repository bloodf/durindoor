import { randomUUID } from "node:crypto";
import {
  finishTrace as finishTraceRepo,
  record as recordRepo,
  startTrace as startTraceRepo,
} from "@/lib/db/repos/proxyTimelineRepo.js";
import { createClientFrameFramer } from "./proxyTimelineFrame.js";
import { isOtelEnabled, isOtelOnlySpan, otelEvent, otelFinish, otelFirstByte, otelStart } from "../../services/otelTracing.js";

// OTel-only ids (timeline persistence disabled) are flagged on the bounded
// active-span map in otelTracing.js (MAX_ACTIVE_SPANS), so an id abandoned by a
// throw path can never grow an unbounded set here. The repo ignores unknown ids.

/**
 * Start a proxy-timeline trace and, when OTLP export is configured, a routing
 * span (#1128). `ctx.requestId` (the client request id) becomes the OTel trace
 * id so fallback attempts share a trace; it is never written to the timeline.
 */
export function startTrace(fields, ctx = {}) {
  const repoId = startTraceRepo(fields);
  if (!isOtelEnabled()) return repoId;
  const id = repoId || randomUUID();
  otelStart(id, fields, { ...ctx, otelOnly: !repoId });
  return id;
}

export const record = (traceId, event) => {
  const otelOnly = isOtelOnlySpan(traceId);
  otelEvent(traceId, event);
  if (!otelOnly) recordRepo(traceId, event);
};

export const finishTrace = (traceId, fields) => {
  const otelOnly = isOtelOnlySpan(traceId);
  otelFinish(traceId, fields);
  if (!otelOnly) finishTraceRepo(traceId, fields);
};

export function attachClientFrameTap(traceId, format) {
  if (isOtelOnlySpan(traceId)) {
    return { onClientBytes() { otelFirstByte(traceId); }, onClientEnd() {}, onClientAbort() {} };
  }
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
