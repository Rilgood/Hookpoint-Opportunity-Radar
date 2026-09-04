#!/usr/bin/env node
// Regenerates src/db/schema-manifest.js from a freshly migrated in-memory
// SQLite database. Run after adding a migration: `pnpm run db:manifest`.
import { schema } from './schema.js';
import { applyMigrations, buildManifest, writeManifest } from './migrations.js';
import { openSqlite } from './sqlite.js';
import { wrapDriver } from './index.js';

const db = wrapDriver(openSqlite(':memory:'));
db.exec(schema);
applyMigrations(db);
const manifest = buildManifest(db);
db.close();
const written = writeManifest(manifest);
console.log(`Wrote ${written} (schema version ${manifest.version}, ${Object.keys(manifest.tables).length} tables).`);
