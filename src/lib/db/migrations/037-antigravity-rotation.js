import { TABLES, buildCreateTableSql } from "../schema.js";
import { translateCreateTable } from "../dialects/postgres/translate.js";

const TABLES_TO_CREATE = ["antigravityRefreshLeases", "antigravityRecoveryCredentials"];

const migration = {
  version: 37,
  name: "antigravity-rotation",
  up(db) {
    const pg = db.driver === "pg";
    for (const name of TABLES_TO_CREATE) {
      db.exec(pg ? translateCreateTable(name, TABLES[name]).createSql : buildCreateTableSql(name, TABLES[name]));
    }
  },
};

export default migration;
