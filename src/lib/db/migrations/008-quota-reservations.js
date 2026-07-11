import { QUOTA_V8_TABLES, buildQuotaV8TableSql } from "./quota-v8-schema.js";

const TABLE_NAMES = ["quotaReservations", "quotaReservationItems"];

const migration = {
  version: 8,
  name: "quota-reservations",
  up(db) {
    for (const name of TABLE_NAMES) {
      const definition = QUOTA_V8_TABLES[name];
      db.exec(buildQuotaV8TableSql(name));
      for (const index of definition.indexes || []) db.exec(index);
    }
  },
};

export default migration;
