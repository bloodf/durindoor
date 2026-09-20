import { tokenSaverEventColumns } from "../../../../open-sse/rtk/index.js";

export const TOKEN_SAVER_SUM_COLUMNS = Object.keys(tokenSaverEventColumns({})).filter((name) => name !== "hrState" && name !== "hrSkipReason");
export const TOKEN_SAVER_DAILY_COLUMNS = ["requestsObserved", ...TOKEN_SAVER_SUM_COLUMNS, "compressed", "skipped", "disabled"];
export const TOKEN_SAVER_AGGREGATES = [
  "COUNT(*) AS requestsObserved",
  ...TOKEN_SAVER_SUM_COLUMNS.map((name) => `SUM(${name}) AS ${name}`),
  ...["compressed", "skipped", "disabled"].map((state) => `SUM(CASE WHEN hrState = '${state}' THEN 1 ELSE 0 END) AS ${state}`),
].join(", ");

export const TOKEN_SAVER_DAILY_TABLES = {
  tokenSaverDaily: {
    columns: {
      dateKey: "TEXT NOT NULL", localDateKey: "TEXT NOT NULL",
      ...Object.fromEntries(TOKEN_SAVER_DAILY_COLUMNS.map((name) => [name, "REAL NOT NULL DEFAULT 0"])),
    },
    primaryKey: "PRIMARY KEY (dateKey, localDateKey)",
  },
  tokenSaverDailyReasons: {
    columns: { dateKey: "TEXT NOT NULL", localDateKey: "TEXT NOT NULL", hrSkipReason: "TEXT NOT NULL", count: "REAL NOT NULL DEFAULT 0" },
    primaryKey: "PRIMARY KEY (dateKey, localDateKey, hrSkipReason)",
  },
};

export function backfillTokenSaverDaily(db, where = "", params = []) {
  const dimensions = "SUBSTR(timestamp, 1, 10), dateKey";
  if (!where) {
    db.run("DELETE FROM tokenSaverDaily");
    db.run("DELETE FROM tokenSaverDailyReasons");
  }
  db.run(`INSERT INTO tokenSaverDaily(dateKey, localDateKey, ${TOKEN_SAVER_DAILY_COLUMNS.join(", ")})
    SELECT ${dimensions}, ${TOKEN_SAVER_AGGREGATES} FROM tokenSaverEvents ${where} GROUP BY ${dimensions}
    ON CONFLICT (dateKey, localDateKey) DO UPDATE SET ${TOKEN_SAVER_DAILY_COLUMNS.map((name) => `${name} = excluded.${name}`).join(", ")}`, params);
  db.run(`INSERT INTO tokenSaverDailyReasons(dateKey, localDateKey, hrSkipReason, count)
    SELECT ${dimensions}, COALESCE(hrSkipReason, ''), COUNT(*) FROM tokenSaverEvents
    ${where ? `${where} AND` : "WHERE"} hrState = 'skipped' GROUP BY ${dimensions}, COALESCE(hrSkipReason, '')
    ON CONFLICT (dateKey, localDateKey, hrSkipReason) DO UPDATE SET count = excluded.count`, params);
}
