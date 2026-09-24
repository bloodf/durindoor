import { countRequestDetailsSince, iterateRequestDetailsSince } from "@/lib/db/index.js";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/logs/export — export request-detail logs as streamed JSON.
 * Query params: ?hours=24 (1-168; default 24)
 *               &limit=10000 (max rows; default 10000, max 50000)
 *
 * Ported from OmniRoute's streaming `/api/logs/export` (#9c5d60027, #e21f17ed8).
 * DurinDoor has one log table (`requestDetails`), not OmniRoute's
 * `call_logs`/`proxy_logs` split, so this exports that table only. The row
 * cap is pushed down to the DB layer (`countRequestDetailsSince`/
 * `iterateRequestDetailsSince`): a cheap COUNT(*) for `totalAvailable`, and a
 * LIMIT/OFFSET-paged generator that yields one hydrated row at a time, so
 * peak memory is bounded by one page rather than the full matching set on
 * either SQLite or Postgres (`src/lib/db` abstracts both behind the same
 * adapter). `capped`/`limit`/`totalAvailable` are in the response header so a
 * streaming client learns about truncation before it has read every row.
 */
const MAX_ROWS = 50_000;
const DEFAULT_ROWS = 10_000;

function buildLogExportStream({ rows, header }) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify(header).slice(0, -1) + ',"logs":['));
      let index = 0;
      let streamError = null;
      try {
        for await (const row of rows) {
          if (index > 0) controller.enqueue(encoder.encode(","));
          controller.enqueue(encoder.encode(JSON.stringify(row)));
          index++;
        }
      } catch (err) {
        // The row source is a DB-backed generator; it can throw partway
        // through iteration, after headers and some rows already went out
        // over the wire. Erroring the ReadableStream here would leave the
        // bridged HTTP response hanging instead of ending it, so close the
        // JSON document out cleanly with a trailing error marker instead.
        streamError = err;
        console.error("[logs/export] stream failed mid-iteration:", err);
      }
      controller.enqueue(encoder.encode("]"));
      controller.enqueue(
        encoder.encode(
          streamError ?
          "," + JSON.stringify({
            emitted: index,
            error: sanitizeErrorMessage(streamError instanceof Error ? streamError.message : String(streamError))
          }).slice(1, -1) + "}\n" :
          "}\n"
        )
      );
      controller.close();
    }
  });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = Math.min(Math.max(parseInt(searchParams.get("hours") || "24", 10) || 24, 1), 168);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || String(DEFAULT_ROWS), 10) || DEFAULT_ROWS, 1),
      MAX_ROWS
    );

    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const totalAvailable = await countRequestDetailsSince(since);
    const capped = totalAvailable > limit;
    const count = Math.min(totalAvailable, limit);
    const filename = `durindoor-request-logs-${hours}h-${new Date().toISOString().slice(0, 10)}.json`;

    const header = { count, hours, type: "request-logs" };
    if (capped) {
      header.capped = true;
      header.limit = limit;
      header.totalAvailable = totalAvailable;
    }
    const stream = buildLogExportStream({ rows: iterateRequestDetailsSince(since, limit), header });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    return Response.json(
      { error: { message: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)), type: "server_error" } },
      { status: 500 }
    );
  }
}
