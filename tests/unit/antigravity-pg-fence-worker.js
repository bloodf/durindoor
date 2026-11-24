import { createPostgresAdapter } from "../../src/lib/db/adapters/pgAdapter.js";
import { acquireAntigravityLease, clearAntigravityLease, markAntigravityDispatched } from "../../src/lib/antigravity/leaseSql.js";

const db = await createPostgresAdapter({ url: process.env.AGY_TEST_PG_URL });
const result = acquireAntigravityLease(db, { connectionId: "crash", refreshToken: "synthetic", owner: "child" });
process.send({ ok: result.ok && markAntigravityDispatched(db, result.lease) });
process.on("message", () => process.send({ cleared: clearAntigravityLease(db, result.lease, "rotated-synthetic") }));
setInterval(() => {}, 1000);
