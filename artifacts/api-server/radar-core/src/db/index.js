import { config } from '../config.js';
import { schema } from './schema.js';
import { applyMigrations, recordManagedMigrations, verifySchema } from './migrations.js';
import { openSqlite } from './sqlite.js';
import { PostgresSyncClient } from './postgres.js';

let singleton;

export const POSTGRES_URL = /^postgres(ql)?:\/\//i;

/**
 * Opens the operational store behind the synchronous database boundary.
 *
 * `target` is either a SQLite path (`:memory:` or a file) or a Postgres URL.
 *
 * Options:
 * - `schema`: Postgres schema that holds the radar tables (default `radar`,
 *   never `public`, so the workspace's Drizzle tooling cannot drop them).
 * - `manageSchema`: when true (the default outside production) the schema and
 *   pending migrations are applied on open. In production the schema is owned
 *   by the publish flow, so the opened store is only *verified* against the
 *   checked-in schema manifest and pending data-only migration steps are
 *   recorded; a mismatch surfaces as `db.schemaStatus` for readiness.
 */
export function openDatabase(target = config.databaseTarget, options = {}) {
  const { schema: schemaName = config.databaseSchema, manageSchema = config.manageSchema } = options;
  const driver = POSTGRES_URL.test(String(target))
    ? new PostgresSyncClient(String(target), { schema: schemaName, pgModule: resolvePgModule(), statementTimeoutMs: config.databaseStatementTimeoutMs })
    : openSqlite(target);
  const db = wrapDriver(driver, { schemaName });
  try {
    if (manageSchema) {
      if (db.dialect === 'postgres') db.exec(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
      db.exec(schema);
      applyMigrations(db);
      const status = verifySchema(db);
      if (!status.ok) {
        throw new Error(`The database schema does not match src/db/schema-manifest.js (${describeStatus(status)}). `
          + 'Regenerate the manifest with `pnpm run db:manifest` inside radar-core after changing migrations.');
      }
      db.schemaStatus = status;
    } else {
      db.schemaStatus = verifySchema(db);
      if (db.schemaStatus.ok) recordManagedMigrations(db);
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export function getDb() {
  if (!singleton) singleton = openDatabase();
  return singleton;
}

export function closeDb() {
  if (singleton) singleton.close();
  singleton = undefined;
}

/**
 * Engine-independent detection of a unique-constraint violation, optionally
 * narrowed to a table and a column that participates in the violated key.
 */
export function isUniqueViolation(error, { table, column } = {}) {
  if (!error) return false;
  const message = String(error.message || '');
  if (error.code === '23505') {
    if (table && error.table && error.table !== table) return false;
    if (column && !String(error.detail || '').includes(`(${column}`) && !String(error.constraint || '').includes(column)) return false;
    return true;
  }
  if (message.includes('UNIQUE constraint failed')) {
    if (table && !message.includes(`${table}.`)) return false;
    if (column && !message.includes(`${table ? `${table}.` : ''}${column}`)) return false;
    return true;
  }
  return false;
}

export function describeStatus(status) {
  if (status.ok) return 'schema up to date';
  return `missing ${status.missing.slice(0, 5).join(', ')}${status.missing.length > 5 ? ` and ${status.missing.length - 5} more` : ''}`;
}

function resolvePgModule() {
  try {
    return import.meta.resolve('pg');
  } catch {
    throw new Error('DATABASE_URL points at Postgres but the "pg" driver could not be resolved; install it in the host package (artifacts/api-server).');
  }
}

export function wrapDriver(driver, { schemaName = null } = {}) {
  let inTransaction = false;
  const dialect = driver.dialect;
  return {
    dialect,
    schemaName: dialect === 'postgres' ? schemaName : null,
    native: driver.native,
    schemaStatus: null,
    sql: sqlHelpers(dialect),
    run(sql, params = []) { return driver.run(sql, params); },
    get(sql, params = []) { return driver.query(sql, params)[0]; },
    all(sql, params = []) { return driver.query(sql, params); },
    exec(sql) { return driver.exec(sql); },
    columns(table) { return driver.columns(table); },
    tables() { return driver.tables(); },
    indexes() { return driver.indexes(); },
    transaction(fn) {
      if (inTransaction) throw new Error('Nested transactions are not supported by the database boundary.');
      driver.exec(dialect === 'sqlite' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      inTransaction = true;
      try {
        const value = fn();
        const outcome = driver.exec('COMMIT');
        // Postgres answers COMMIT on an aborted transaction with a silent
        // ROLLBACK. A swallowed statement error inside fn() must not look like
        // a successful write.
        if (outcome?.command === 'ROLLBACK') throw new Error('The transaction was aborted by an earlier statement error and has been rolled back.');
        return value;
      } catch (error) {
        try { driver.exec('ROLLBACK'); } catch { /* the connection is already unusable; surface the original error */ }
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    close() { driver.close(); }
  };
}

/**
 * The few expressions that have no portable spelling between SQLite and
 * Postgres. Services must use these instead of dialect-specific SQL.
 */
function sqlHelpers(dialect) {
  if (dialect === 'postgres') {
    return {
      jsonText: (column, key) => `((${column})::jsonb ->> '${key}')`,
      randomHex: () => `md5(random()::text || clock_timestamp()::text)`
    };
  }
  return {
    jsonText: (column, key) => `json_extract(${column}, '$.${key}')`,
    randomHex: () => `lower(hex(randomblob(16)))`
  };
}
