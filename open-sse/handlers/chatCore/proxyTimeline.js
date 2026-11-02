import { randomUUID } from "node:crypto";
import {
  finishTrace as finishTraceRepo,
  record as recordRepo,
  startTrace as startTraceRepo,
} from "@/lib/db/repos/proxyTimelineRepo.js";
import { createClientFrameFramer } from "./proxyTimelineFrame.js";
import { isOtelEnabled, otelEvent, otelFinish, otelFirstByte, otelStart } from "../../services/otelTracing.js";

// Ids that exist only for OpenTelemetry (timeline persistence disabled). The
// repo ignores them; the frame tap skips SSE framing for them.
const otelOnlyIds = new Set();

/**
 * Start a proxy-timeline trace and, when OTLP export is configured, a routing
 * span (#1128). `ctx.requestId` (the client request id) becomes the OTel trace
 * id so fallback attempts share a trace; it is never written to the timeline.
 */
export function startTrace(fields, ctx = {}) {
  const repoId = startTraceRepo(fields);
  if (!isOtelEnabled()) return repoId;
  const id = repoId || randomUUID();
  if (!repoId) otelOnlyIds.add(id);
  otelStart(id, fields, ctx);
  return id;
}

export const record = (traceId, event) => {
  otelEvent(traceId, event);
  if (!otelOnlyIds.has(traceId)) recordRepo(traceId, event);
};

export const finishTrace = (traceId, fields) => {
  otelFinish(traceId, fields);
  if (otelOnlyIds.delete(traceId)) return;
  finishTraceRepo(traceId, fields);
};

export function attachClientFrameTap(traceId, format) {
  if (otelOnlyIds.has(traceId)) {
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
