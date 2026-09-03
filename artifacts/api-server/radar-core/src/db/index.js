import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { schema } from './schema.js';
import { applyMigrations } from './migrations.js';

let singleton;

export function openDatabase(databasePath = config.databasePath) {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(schema);
  applyMigrations(db);
  return wrap(db);
}

export function getDb() {
  if (!singleton) singleton = openDatabase();
  return singleton;
}

export function closeDb() {
  if (singleton) singleton.close();
  singleton = undefined;
}

function wrap(nativeDb) {
  return {
    native: nativeDb,
    run(sql, params = []) { return nativeDb.prepare(sql).run(...params); },
    get(sql, params = []) { return object(nativeDb.prepare(sql).get(...params)); },
    all(sql, params = []) { return nativeDb.prepare(sql).all(...params).map(object); },
    exec(sql) { return nativeDb.exec(sql); },
    transaction(fn) {
      nativeDb.exec('BEGIN IMMEDIATE');
      try {
        const value = fn();
        nativeDb.exec('COMMIT');
        return value;
      } catch (error) {
        nativeDb.exec('ROLLBACK');
        throw error;
      }
    },
    close() { nativeDb.close(); }
  };
}

function object(row) {
  return row ? { ...row } : undefined;
}
