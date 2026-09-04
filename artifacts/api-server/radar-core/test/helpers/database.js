import { randomBytes } from 'node:crypto';
import { openDatabase } from '../../src/db/index.js';

/**
 * Opens an isolated database for a test.
 *
 * By default this is an in-memory SQLite database. When RADAR_TEST_DATABASE_URL
 * points at Postgres, every call creates a private schema in that database and
 * drops it on close, so the same suite exercises the Postgres adapter and the
 * portable SQL against the engine used in production.
 */
export function openTestDatabase() {
  const target = testDatabaseTarget();
  if (target === ':memory:') return openDatabase(target);
  const schema = `radar_test_${randomBytes(6).toString('hex')}`;
  const db = openDatabase(target, { schema, manageSchema: true });
  const close = db.close.bind(db);
  db.close = () => {
    try { db.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { close(); }
  };
  return db;
}

export function testDatabaseTarget() {
  return process.env.RADAR_TEST_DATABASE_URL || ':memory:';
}

/** Options a second connection needs to reach the same test database. */
export function attachOptions(db) {
  return db.dialect === 'postgres' ? { schema: db.schemaName, manageSchema: false } : {};
}
