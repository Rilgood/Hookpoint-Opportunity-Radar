import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const pragmas = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA wal_autocheckpoint = 1000;
`;

export function openSqlite(databasePath) {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const native = new DatabaseSync(databasePath);
  native.exec(pragmas);
  return {
    dialect: 'sqlite',
    native,
    query(sql, params) { return native.prepare(sql).all(...params).map(object); },
    run(sql, params) { return native.prepare(sql).run(...params); },
    exec(sql) { native.exec(sql); },
    columns(table) { return native.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name); },
    tables() {
      return native.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map((row) => row.name);
    },
    // Explicitly created indexes only; the automatic PRIMARY KEY/UNIQUE indexes
    // have no SQL text and are named differently by each engine.
    indexes() {
      return native.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name`).all().map((row) => row.name);
    },
    close() { native.close(); }
  };
}

function object(row) {
  return row ? { ...row } : undefined;
}
