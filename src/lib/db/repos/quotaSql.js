/**
 * Force SQLite to acquire the common writer lock before quota read-modify-write
 * transactions. Kept dependency-free so sync reservation primitives can run in
 * isolated workers without loading the application database driver.
 */
export const QUOTA_WRITE_LOCK_SQL = `UPDATE _meta SET value = value WHERE key = 'schemaVersion'`;
/** PG: row-lock the schemaVersion key inside BEGIN so concurrent acquires serialize. */
export const QUOTA_WRITE_LOCK_SQL_PG = `SELECT value FROM _meta WHERE key = 'schemaVersion' FOR UPDATE`;
