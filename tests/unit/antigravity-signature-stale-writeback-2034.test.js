import { describe, expect, it, vi } from "vitest";

// Regression for #2034; cases A/B/C reproduce the independent review scenario.
// Question: when a NEW signature write to SQLite fails while an OLDER persisted
// row exists under the same key, does a cold read return the stale prior
// signature instead of the new one?
const mocks = vi.hoisted(() => ({ failWrites: false, patched: false, adapterClosed: false, gate: null, attempts: 0 }));

vi.mock("../../src/lib/db/driver.js", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    getAdapterSync: () => { if (mocks.adapterClosed) throw new Error("[DB] adapter not initialized — await getAdapter() first"); return real.getAdapterSync(); },
    getAdapter: async () => {
      if (mocks.gate) await mocks.gate;
      const db = await real.getAdapter();
      if (!mocks.patched) {
        mocks.patched = true;
        const origRun = db.run.bind(db);
        // SQLITE_BUSY on the upsert only; reads keep working (rollback-journal
        // mode lets readers proceed while a writer cannot get the RESERVED lock).
        db.run = (sql, params) => {
          if (String(sql).includes("ON CONFLICT(scope, key) DO UPDATE")) mocks.attempts++;
          if (mocks.failWrites && String(sql).includes("ON CONFLICT(scope, key) DO UPDATE")) {
            throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
          }
          return origRun(sql, params);
        };
      }
      return db;
    },
  };
});

const store = await import("../../open-sse/services/thoughtSignatureStore.js");
const { getAdapter } = await import("../../src/lib/db/driver.js");

const GEMINI = "gemini-4-argon";
const SCOPE = "gemini_thought_signatures";
const SESSION = "antigravity:s1";
const stamp = Date.now();
const UPSERT = "INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value";

describe("review repro: pending/failed overwrite over an older persisted row", () => {
  it("case A (control): write fails, no older row -> cold read must return NEW", async () => {
    await store.getGeminiThoughtSignature("warmup", null, GEMINI);
    const id = `repro-a-${stamp}`;
    mocks.failWrites = true;
    store.storeGeminiThoughtSignature(id, "NEW-A", SESSION, GEMINI, "acct-A");
    mocks.failWrites = false;
    store.clearThoughtSignatureMemory();
    const got = await store.getProvenThoughtSignature(id, { accountId: "acct-A", sessionId: SESSION, model: GEMINI });
    console.log("CASE A read ->", JSON.stringify(got));
    expect(got).toBe("NEW-A");
  });

  it("case B: write fails while an OLDER row exists -> cold read must not return the stale OLD", async () => {
    const db = await getAdapter();
    const id = `repro-b-${stamp}`;
    const now = Date.now();
    const old = { signature: "OLD-B", family: "gemini", createdAt: now - 1000, expiresAt: now + 3_600_000, account: "acct-A" };
    db.run(UPSERT, [SCOPE, `${SESSION}:${id}`, JSON.stringify(old)]);
    db.run(UPSERT, [SCOPE, id, JSON.stringify(old)]);

    mocks.failWrites = true;
    store.storeGeminiThoughtSignature(id, "NEW-B", SESSION, GEMINI, "acct-A");
    mocks.failWrites = false;
    store.clearThoughtSignatureMemory();

    const got = await store.getProvenThoughtSignature(id, { accountId: "acct-A", sessionId: SESSION, model: GEMINI });
    const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [SCOPE, `${SESSION}:${id}`]);
    console.log("CASE B read ->", JSON.stringify(got));
    console.log("CASE B persisted row ->", row?.value);
    console.log("CASE B stale (read returned OLD-B) ->", got === "OLD-B");
    expect(got).toBe("NEW-B");
  });

  it("case C: adapter closed (write-behind pending) with an OLDER row -> cold read must return NEW", async () => {
    const db = await getAdapter();
    const id = `repro-c-${stamp}`;
    const now = Date.now();
    const old = { signature: "OLD-C", family: "gemini", createdAt: now - 1000, expiresAt: now + 3_600_000, account: "acct-A" };
    db.run(UPSERT, [SCOPE, `${SESSION}:${id}`, JSON.stringify(old)]);
    db.run(UPSERT, [SCOPE, id, JSON.stringify(old)]);
    // Make getAdapterSync() report "adapter not open" -> the write-behind path.
    mocks.adapterClosed = true;
    store.storeGeminiThoughtSignature(id, "NEW-C", SESSION, GEMINI, "acct-A");
    mocks.adapterClosed = false;
    store.clearThoughtSignatureMemory();
    const got = await store.getProvenThoughtSignature(id, { accountId: "acct-A", sessionId: SESSION, model: GEMINI });
    console.log("CASE C read ->", JSON.stringify(got));
    expect(got).toBe("NEW-C");
  });
});


const scope = { accountId: "acct-A", sessionId: SESSION, model: GEMINI };
const cold = async (id, provenance = scope) => {
  store.clearThoughtSignatureMemory();
  return store.getProvenThoughtSignature(id, provenance);
};
const persisted = async (id) => JSON.parse((await getAdapter()).get(
  "SELECT value FROM kv WHERE scope = ? AND key = ?", [SCOPE, `${SESSION}:${id}`],
).value);

describe("failed replacement bookkeeping", () => {
  it("keeps NEW during persistent failure, retries once per cold read, then cleans up", async () => {
    const id = "persistent-failure";
    store.storeGeminiThoughtSignature(id, "OLD", SESSION, GEMINI, "acct-A");
    mocks.failWrites = true;
    try {
      store.storeGeminiThoughtSignature(id, "NEW", SESSION, GEMINI, "acct-A");
      const attempts = mocks.attempts;
      expect(await cold(id)).toBe("NEW");
      expect(await cold(id)).toBe("NEW");
      expect(mocks.attempts - attempts).toBe(2);
      expect((await persisted(id)).signature).toBe("OLD");
    } finally { mocks.failWrites = false; }
    expect(await cold(id)).toBe("NEW");
    expect((await persisted(id)).signature).toBe("NEW");
    const attempts = mocks.attempts;
    expect(await cold(id)).toBe("NEW");
    expect(mocks.attempts).toBe(attempts);
  });

  it("a delayed older write and its waiting reader observe the newest capture", async () => {
    const id = "concurrent-latest";
    let release;
    mocks.gate = new Promise((resolve) => { release = resolve; });
    mocks.adapterClosed = true;
    store.storeGeminiThoughtSignature(id, "OLDER-PENDING", SESSION, GEMINI, "acct-A");
    const reading = cold(id);
    mocks.adapterClosed = false;
    store.storeGeminiThoughtSignature(id, "LATEST", SESSION, GEMINI, "acct-A");
    mocks.gate = null;
    release();
    expect(await reading).toBe("LATEST");
    expect(await cold(id)).toBe("LATEST");
    expect((await persisted(id)).signature).toBe("LATEST");
  });

  it("retains changed provenance even when the signature text is identical", async () => {
    const id = "same-signature-new-account";
    store.storeGeminiThoughtSignature(id, "SAME", SESSION, GEMINI, "acct-B");
    mocks.failWrites = true;
    try {
      store.storeGeminiThoughtSignature(id, "SAME", SESSION, GEMINI, "acct-A");
      expect(await cold(id, { ...scope, accountId: "acct-B" })).toBeNull();
      expect(await cold(id, { ...scope, sessionId: "other", accountId: "acct-B" })).toBeNull();
      expect(await cold(id, { ...scope, model: "claude-sonnet" })).toBeNull();
      expect(await cold(id)).toBe("SAME");
      expect(await store.getGeminiThoughtSignature(id, SESSION, GEMINI)).toBeNull();
    } finally { mocks.failWrites = false; }
    expect(await cold(id)).toBe("SAME");
    expect(await persisted(id)).toMatchObject({ account: "acct-A", family: "gemini" });
  });

  it("does not extend original expiry or resurrect a longer-lived old row", async () => {
    const id = "expiry-original";
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const db = await getAdapter();
    const old = { signature: "OLD", family: "gemini", account: "acct-A", createdAt: now, expiresAt: now + 30 * 86400000 };
    db.run(UPSERT, [SCOPE, `${SESSION}:${id}`, JSON.stringify(old)]);
    db.run(UPSERT, [SCOPE, id, JSON.stringify(old)]);
    mocks.failWrites = true;
    try {
      store.storeGeminiThoughtSignature(id, "NEW", SESSION, GEMINI, "acct-A");
      clock.mockReturnValue(now + 6 * 86400000);
      expect(await cold(id)).toBe("NEW");
      clock.mockReturnValue(now + 7 * 86400000);
      expect(await cold(id)).toBeNull();
      expect(await cold(id)).toBeNull();
      mocks.failWrites = false;
      expect(await cold(id)).toBeNull();
      expect(await cold(id)).toBeNull();
    } finally { mocks.failWrites = false; clock.mockRestore(); }
  });

  it("a retry preserves the capture timestamps rather than restarting TTL", async () => {
    const id = "expiry-retry";
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    mocks.failWrites = true;
    store.storeGeminiThoughtSignature(id, "NEW", SESSION, GEMINI, "acct-A");
    mocks.failWrites = false;
    try {
      clock.mockReturnValue(now + 3600001);
      expect(await cold(id)).toBe("NEW");
      expect(await persisted(id)).toEqual({ signature: "NEW", family: "gemini", account: "acct-A", createdAt: now, expiresAt: now + 7 * 86400000 });
    } finally { clock.mockRestore(); }
  });
});


describe("pending lifecycle", () => {
  it("a capture during a cold read's adapter open hides the old persisted row", async () => {
    const id = "read-open-race";
    store.storeGeminiThoughtSignature(id, "OLD", SESSION, GEMINI, "acct-A");
    let release;
    mocks.gate = new Promise((resolve) => { release = resolve; });
    const reading = cold(id);
    mocks.failWrites = true;
    store.storeGeminiThoughtSignature(id, "NEW", SESSION, GEMINI, "acct-A");
    mocks.gate = null;
    release();
    try { expect(await reading).toBe("NEW"); }
    finally { mocks.failWrites = false; }
  });

  it("clearing cancels deferred writes without resurrecting them", async () => {
    const id = "cancelled-write";
    let release;
    mocks.gate = new Promise((resolve) => { release = resolve; });
    mocks.adapterClosed = true;
    store.storeGeminiThoughtSignature(id, "CANCELLED", SESSION, GEMINI, "acct-A");
    mocks.adapterClosed = false;
    const clearing = store.clearThoughtSignatures();
    mocks.gate = null;
    release();
    await clearing;
    expect(await cold(id)).toBeNull();
  });

  it("bounds failed pending rows to 2000 and retains the newest", async () => {
    mocks.failWrites = true;
    try {
      for (let i = 0; i < 2001; i++) store.storeGeminiThoughtSignature(`bounded-${i}`, `SIG-${i}`);
      store.clearThoughtSignatureMemory();
      expect(await store.getGeminiThoughtSignature("bounded-0")).toBeNull();
      expect(await store.getGeminiThoughtSignature("bounded-2000")).toBe("SIG-2000");
    } finally { mocks.failWrites = false; }
  });
});
