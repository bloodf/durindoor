import { isNumber, isObject, isString } from "../../../shared/utils/typeChecks.js";
import { TABLES } from "../schema.js";
import { translateColumnDef } from "../dialects/postgres/translate.js";

// Frozen migration projection: historical backfills must not follow runtime changes.
const SAFE_HEADROOM_DIAGNOSTICS = Object.freeze([
"disabled",
"missing-proxy-url",
"timeout",
"http-error",
"unsafe-responses-input",
"translation-failed",
"unsupported-shape",
"invalid-proxy-response",
"unexpected-error",
"other-skip"]
);

function safeHeadroomDiagnostic(value) {
  if (!isString(value) || !value) return null;
  return SAFE_HEADROOM_DIAGNOSTICS.includes(value) ? value : "other-skip";
}

function toNonNeg(v) {
  const n = isString(v) ? Number(v) : v;
  return isNumber(n) && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Normalize one logical request's token-saver outcome into the pieces kept.
 * Each source contributes its OWN delta exactly once. Returns a canonical,
 * JSON-safe event; unknown/garbage fields coerce to 0 so a bad caller can
 * never poison the aggregate.
 *
 * Sources and their measures (never mix a source delta with the overall
 * pipeline delta — that would double count):
 *   rtk:       content bytes (UTF-8) removed from tool_result text.
 *   headroom:  reported token delta (tokensSaved) + actual body bytes.
 *   pxpipe:    estimated token delta (tokensSavedEst) — image billing model.
 * `totals.actualBytesSaved` is rtk.bytesSaved + max(0, headroom body bytes
 * shrink) only; pxpipe/compression stay separate estimates (not bytes).
 */
function normalizeTokenSaverEvent(event) {
  const e = event && isObject(event) ? event : {};
  const rtk = e.rtk && isObject(e.rtk) ? e.rtk : {};
  const headroom = e.headroom && isObject(e.headroom) ? e.headroom : {};
  const pxpipe = e.pxpipe && isObject(e.pxpipe) ? e.pxpipe : {};

  const rtkBytesSaved = toNonNeg(rtk.bytesSaved);
  const hrState = ["compressed", "skipped", "disabled"].includes(headroom.state) ? headroom.state : "disabled";
  // Skip is observed, never saved: a non-compressed Headroom pass keeps its
  // state bucket and diagnostic, but its reported token/byte deltas are NOT
  // savings (the proxy declined to compress). Zero them so a malformed
  // positive-delta skip can never inflate the aggregate (upstream #2562
  // invariant: disabled/skipped never increases Headroom savings fields).
  const hrCompressed = hrState === "compressed";
  const hrBodyBefore = hrCompressed ? toNonNeg(headroom.bodyBytesBefore) : 0;
  const hrBodyAfter = hrCompressed ? toNonNeg(headroom.bodyBytesAfter) : 0;
  const hrBodyShrink = Math.max(0, hrBodyBefore - hrBodyAfter);

  return {
    requestsObserved: 1,
    rtk: {
      requestsWithHits: toNonNeg(rtk.requestsWithHits),
      hits: toNonNeg(rtk.hits),
      bytesBefore: toNonNeg(rtk.bytesBefore),
      bytesAfter: toNonNeg(rtk.bytesAfter),
      bytesSaved: rtkBytesSaved
    },
    headroom: {
      // "compressed" | "skipped" | "disabled"
      state: hrState,
      tokensBefore: hrCompressed ? toNonNeg(headroom.tokensBefore) : 0,
      tokensAfter: hrCompressed ? toNonNeg(headroom.tokensAfter) : 0,
      tokensSaved: hrCompressed ? toNonNeg(headroom.tokensSaved) : 0,
      bodyBytesBefore: hrBodyBefore,
      bodyBytesAfter: hrBodyAfter,
      phantomSavings: hrCompressed && headroom.phantomSavings ? 1 : 0,
      diagnostic: safeHeadroomDiagnostic(headroom.diagnostic)
    },
    pxpipe: {
      applied: pxpipe.applied ? 1 : 0,
      tokensBeforeEst: toNonNeg(pxpipe.tokensBeforeEst),
      tokensAfterEst: toNonNeg(pxpipe.tokensAfterEst),
      tokensSavedEst: toNonNeg(pxpipe.tokensSavedEst),
      imageCount: toNonNeg(pxpipe.imageCount)
    },
    totals: {
      actualBytesSaved: rtkBytesSaved + hrBodyShrink
    }
  };
}

// Storage projection only: normalization above remains the sole coercion and
// state-gating implementation, shared by live writes and migration backfills.
function tokenSaverEventColumns(event) {
  const e = normalizeTokenSaverEvent(event);
  return {
    rtkRequestsWithHits: e.rtk.requestsWithHits,
    rtkHits: e.rtk.hits,
    rtkBytesBefore: e.rtk.bytesBefore,
    rtkBytesAfter: e.rtk.bytesAfter,
    rtkBytesSaved: e.rtk.bytesSaved,
    hrTokensBefore: e.headroom.tokensBefore,
    hrTokensAfter: e.headroom.tokensAfter,
    hrTokensSaved: e.headroom.tokensSaved,
    hrBodyBytesBefore: e.headroom.bodyBytesBefore,
    hrBodyBytesAfter: e.headroom.bodyBytesAfter,
    hrPhantomSavings: e.headroom.phantomSavings,
    pxApplied: e.pxpipe.applied,
    pxTokensBeforeEst: e.pxpipe.tokensBeforeEst,
    pxTokensAfterEst: e.pxpipe.tokensAfterEst,
    pxTokensSavedEst: e.pxpipe.tokensSavedEst,
    pxImageCount: e.pxpipe.imageCount,
    totalActualBytesSaved: e.totals.actualBytesSaved,
    hrState: e.headroom.state,
    hrSkipReason: e.headroom.state === "skipped" ? e.headroom.diagnostic || "other-skip" : null,
  };
}


const migration = {
  version: 20,
  name: "token-saver-aggregates",
  up(db) {
    const names = Object.keys(tokenSaverEventColumns({}));
    // PG reflection/DDL differs; data normalization and backfill DML do not.
    const pg = db.driver === "pg";

    // A stamped database can legitimately be missing tables an earlier
    // migration would have created (see the "repairs a stamped vN database
    // whose tables are absent" cases). Touching one unconditionally aborts the
    // whole upgrade, so every statement below is gated on the table existing.
    const hasTable = (table) => (pg
      ? db.all(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?",
        [table]
      )
      : db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table])
    ).length > 0;

    if (hasTable("tokenSaverEvents")) {
      const existing = new Set((pg
        ? db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", ["tokenSaverEvents"])
        : db.all("PRAGMA table_info(tokenSaverEvents)")).map((c) => c.name));
      for (const name of names) {
        if (existing.has(name)) continue;
        const def = TABLES.tokenSaverEvents.columns[name];
        db.exec(`ALTER TABLE "tokenSaverEvents" ADD COLUMN "${name}" ${pg ? translateColumnDef(name, def) : def}`);
      }
      // Keyset-paginated backfill: the raw `data` JSON stays the source of
      // truth and is normalized through the same helper the write path uses.
      //
      // The write shape differs by engine for a measured reason. On SQLite an
      // UPDATE is an in-process call, so row-at-a-time costs microseconds. On
      // PostgreSQL every statement is a round trip through the synchronous
      // worker bridge, and 592k single-row updates took a real install past
      // ten minutes with no HTTP listener — migrations run before the server
      // accepts requests, so that is an outage, not a slow start. Batching
      // collapses it to one statement per page.
      //
      // SQLite keeps the simple path deliberately: `UPDATE ... FROM (VALUES
      // ...)` with column aliases is not dependable across the better-sqlite3
      // / node:sqlite / sql.js adapters this project falls back through.
      const columnCast = (name) => {
        const def = String(TABLES.tokenSaverEvents.columns[name] || "");
        if (/^REAL\b/i.test(def)) return "DOUBLE PRECISION";
        if (/^INTEGER\b/i.test(def)) return "BIGINT";
        return "TEXT";
      };
      const project = (row) => {
        let event;
        try { event = JSON.parse(row.data); } catch { event = {}; }
        return tokenSaverEventColumns(event);
      };
      const writePage = (rows) => {
        if (!pg) {
          for (const row of rows) {
            db.run(
              `UPDATE "tokenSaverEvents" SET ${names.map((name) => `"${name}" = ?`).join(", ")} WHERE id = ?`,
              [...Object.values(project(row)), row.id]
            );
          }
          return;
        }
        // Casts are explicit: a bare parameter inside VALUES has no inferable
        // type on PostgreSQL.
        const tuple = `(CAST(? AS BIGINT), ${names.map((name) => `CAST(? AS ${columnCast(name)})`).join(", ")})`;
        const params = [];
        for (const row of rows) {
          const values = project(row);
          params.push(row.id, ...names.map((name) => values[name]));
        }
        db.run(
          `UPDATE "tokenSaverEvents" AS t SET ${names.map((name) => `"${name}" = v."${name}"`).join(", ")} ` +
          `FROM (VALUES ${rows.map(() => tuple).join(", ")}) AS v(id, ${names.map((name) => `"${name}"`).join(", ")}) ` +
          "WHERE t.id = v.id",
          params
        );
      };
      let lastId = 0;
      for (;;) {
        const rows = db.all('SELECT id, data FROM "tokenSaverEvents" WHERE id > ? ORDER BY id LIMIT 500', [lastId]);
        if (!rows.length) break;
        writePage(rows);
        lastId = rows[rows.length - 1].id;
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_tse_date_state ON "tokenSaverEvents"("dateKey", "hrState")');
    }

    if (hasTable("usageHistory")) {
      // Covering index for the usage-stats overlay: one index-only scan instead
      // of four heap-reading GROUP BY passes.
      db.exec('CREATE INDEX IF NOT EXISTS idx_uh_ts_dims ON "usageHistory"(timestamp, provider, model, "connectionId", "apiKey", endpoint)');
    }
  },
};

export default migration;
