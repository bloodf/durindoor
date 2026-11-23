import { createPostgresAdapter } from "../../src/lib/db/adapters/pgAdapter.js";
import { acquireAntigravityLease, markAntigravityDispatched } from "../../src/lib/antigravity/leaseSql.js";

const db = await createPostgresAdapter({ url: process.env.AGY_TEST_PG_URL });
const result = acquireAntigravityLease(db, { connectionId: "crash", refreshToken: "synthetic", owner: "child" });
process.send({ ok: result.ok && markAntigravityDispatched(db, result.lease) });
setInterval(() => {}, 1000);
