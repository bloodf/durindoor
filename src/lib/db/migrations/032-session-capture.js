const migration = {
  version: 32,
  name: "session-capture",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS "sessionCaptureTurns" (
      "id" TEXT PRIMARY KEY, "apiKeyId" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
      "content" TEXT NOT NULL, "byteSize" INTEGER NOT NULL CHECK ("byteSize" BETWEEN 1 AND 16384),
      "createdAt" TEXT NOT NULL, "expiresAt" TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_capture_key_session ON "sessionCaptureTurns" ("apiKeyId", "sessionId", "createdAt", "id")');
    db.exec('CREATE INDEX IF NOT EXISTS idx_capture_expiry ON "sessionCaptureTurns" ("expiresAt")');
  },
};

export default migration;
