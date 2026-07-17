/**
 * Force SQLite to acquire the common writer lock before quota read-modify-write
 * transactions. Kept dependency-free so sync reservation primitives can run in
 * isolated workers without loading the application database driver.
 */
export const QUOTA_WRITE_LOCK_SQL = `UPDATE _meta SET value = value WHERE key = 'schemaVersion'`;
