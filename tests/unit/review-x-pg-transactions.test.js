// Issue 2261, item 1: the async PG adapter shares one client, so concurrent
// transaction() calls must not interleave their BEGIN/SAVEPOINT statements.

import { describe, it, expect } from "vitest";
import { createPostgresAdapter } from "@/lib/db/adapters/pgAdapter.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function ticks(count = 10) {
  for (let i = 0; i < count; i += 1) await tick();
}

// Single-connection fake with PostgreSQL transaction semantics: uncommitted
// rows live in `pending`, and savepoints are a stack over it.
function makeTxClient() {
  const log = [];
  const committed = [];
  const failures = new Set();
  let pending = null;
  let savepoints = [];

  function findSavepoint(name) {
    const index = savepoints.findLastIndex((s) => s.name === name);
    if (index === -1) throw new Error(`savepoint "${name}" does not exist`);
    return index;
  }

  const client = {
    _ending: false,
    async connect() {},
    async end() {},
    async query(sql, params) {
      const text = String(sql).trim();
      log.push(text);
      await tick();
      if (failures.delete(text)) throw new Error(`${text} failed`);
      let match;
      if (text === "BEGIN") {
        pending ??= [];
      } else if (text === "COMMIT") {
        if (pending) committed.push(...pending);
        pending = null;
        savepoints = [];
      } else if (text === "ROLLBACK") {
        pending = null;
        savepoints = [];
      } else if ((match = text.match(/^SAVEPOINT (\w+)$/))) {
        if (!pending) throw new Error("SAVEPOINT outside a transaction");
        savepoints.push({ name: match[1], size: pending.length });
      } else if ((match = text.match(/^ROLLBACK TO SAVEPOINT (\w+)$/))) {
        const index = findSavepoint(match[1]);
        pending.length = savepoints[index].size;
        savepoints.length = index + 1;
      } else if ((match = text.match(/^RELEASE SAVEPOINT (\w+)$/))) {
        savepoints.length = findSavepoint(match[1]);
      } else if (text.startsWith("INSERT")) {
        (pending ?? committed).push(params[0]);
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, log, committed, failures };
}

async function setup() {
  const fake = makeTxClient();
  const adapter = await createPostgresAdapter({
    url: "postgres://u@h/db",
    clientFactory: () => fake.client,
  });
  fake.log.length = 0;
  const insert = (value) => adapter.run("INSERT INTO t(v) VALUES(?)", [value]);
  return { ...fake, adapter, insert };
}

const boundaries = (log) => log.filter((s) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(s));

// Replace random savepoint names with stable labels in order of appearance.
function normalize(log) {
  const names = new Map();
  return log.map((s) =>
    s.replace(/sp_\w+/, (name) => {
      if (!names.has(name)) names.set(name, `sp${names.size + 1}`);
      return names.get(name);
    })
  );
}

describe("pgAdapter async transactions", () => {
  it.each([
    ["the first caller", true],
    ["the second caller", false],
  ])("keeps the other writes when %s rolls back concurrently", async (_label, failFirst) => {
    const { adapter, insert, log, committed } = await setup();
    const keep = () =>
      adapter.transaction(async () => {
        await insert("keep-1");
        await ticks();
        await insert("keep-2");
        return "kept";
      });
    const drop = () =>
      adapter.transaction(async () => {
        await insert("drop");
        await ticks(3);
        throw new Error("boom");
      });

    const calls = failFirst ? [drop(), keep()] : [keep(), drop()];
    const results = await Promise.allSettled(calls);
    const [dropped, kept] = failFirst ? results : [...results].reverse();

    expect(kept).toEqual({ status: "fulfilled", value: "kept" });
    expect(dropped.status).toBe("rejected");
    expect(dropped.reason.message).toBe("boom");
    expect(committed).toEqual(["keep-1", "keep-2"]);
    expect(boundaries(log)).toEqual(
      failFirst
        ? ["BEGIN", "ROLLBACK", "BEGIN", "COMMIT"]
        : ["BEGIN", "COMMIT", "BEGIN", "ROLLBACK"]
    );
  });

  it("uses savepoints for nested calls and rolls back only the inner one", async () => {
    const { adapter, insert, log, committed } = await setup();
    await adapter.transaction(async () => {
      await insert("outer");
      await expect(
        adapter.transaction(async () => {
          await insert("inner");
          throw new Error("inner boom");
        })
      ).rejects.toThrow("inner boom");
    });

    expect(committed).toEqual(["outer"]);
    expect(normalize(log)).toEqual([
      "BEGIN",
      "SAVEPOINT sp1",
      "INSERT INTO t(v) VALUES($1)",
      "SAVEPOINT sp2",
      "INSERT INTO t(v) VALUES($1)",
      "ROLLBACK TO SAVEPOINT sp2",
      "RELEASE SAVEPOINT sp2",
      "RELEASE SAVEPOINT sp1",
      "COMMIT",
    ]);
  });

  it("does not let sibling nested transactions undo each other", async () => {
    const { adapter, insert, log, committed } = await setup();
    await adapter.transaction(async () => {
      const results = await Promise.allSettled([
        adapter.transaction(async () => {
          await insert("drop");
          await ticks(3);
          throw new Error("boom");
        }),
        adapter.transaction(async () => {
          await insert("keep");
          await ticks();
        }),
      ]);
      expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
    });

    expect(committed).toEqual(["keep"]);
    expect(boundaries(log)).toEqual(["BEGIN", "COMMIT"]);
  });

  it("finishes an un-awaited nested transaction before committing", async () => {
    const { adapter, insert, log, committed } = await setup();
    let inner;
    await adapter.transaction(() => {
      inner = adapter.transaction(async () => {
        await ticks();
        await insert("inner");
      });
    });
    await inner;

    expect(committed).toEqual(["inner"]);
    expect(log.at(-1)).toBe("COMMIT");
  });

  it("starts a new transaction for work scheduled by a finished one", async () => {
    const { adapter, insert, log, committed } = await setup();
    let later;
    await adapter.transaction(() => {
      later = ticks(30).then(() => adapter.transaction(() => insert("later")));
    });
    await later;

    expect(committed).toEqual(["later"]);
    expect(boundaries(log)).toEqual(["BEGIN", "COMMIT", "BEGIN", "COMMIT"]);
  });

  it.each(["BEGIN", "COMMIT"])("keeps the queue usable when %s fails", async (statement) => {
    const { adapter, insert, committed, failures } = await setup();
    failures.add(statement);
    const results = await Promise.allSettled([
      adapter.transaction(() => insert("first")),
      adapter.transaction(() => insert("second")),
    ]);

    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
    expect(results[0].reason.message).toBe(`${statement} failed`);
    expect(committed).toEqual(["second"]);
  });
});
