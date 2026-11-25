// One OS process with its own production PostgreSQL adapter. The parent
// releases every worker with a single "go" so the lease calls contend on the
// server rather than being serialized by the test.
import { createPostgresAdapter } from "../../src/lib/db/adapters/pgAdapter.js";
import * as lease from "../../src/lib/antigravity/leaseSql.js";

const db = await createPostgresAdapter({ url: process.env.AGY_TEST_PG_URL });
process.on("message", async (message) => {
  if (message?.type !== "go") return;
  let result;
  try {
    if (message.op === "acquire") result = lease.acquireAntigravityLease(db, message.args);
    else if (message.op === "fence") {
      db.transaction(() => lease.fenceAntigravityRecovery(db, message.args.connectionId, message.args.options));
      result = { ok: true };
    } else if (message.op === "dispatch") result = { ok: lease.markAntigravityDispatched(db, message.args) };
    else throw new Error(`unknown op ${message.op}`);
  } catch (error) {
    result = { error: error.message };
  }
  await db.close();
  process.send({ type: "result", result }, () => process.exit(0));
});
process.send({ type: "ready" });
