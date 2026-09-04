import test from 'node:test';
import assert from 'node:assert/strict';
import { schema } from '../src/db/schema.js';
import { schemaManifest } from '../src/db/schema-manifest.js';
import { applyMigrations, buildManifest, latestVersion, verifySchema } from '../src/db/migrations.js';
import { openSqlite } from '../src/db/sqlite.js';
import { wrapDriver } from '../src/db/index.js';
import { openTestDatabase } from './helpers/database.js';

test('the checked-in schema manifest matches a freshly migrated database', () => {
  const db = wrapDriver(openSqlite(':memory:'));
  try {
    db.exec(schema);
    applyMigrations(db);
    const fresh = buildManifest(db);
    assert.equal(fresh.version, latestVersion);
    assert.deepEqual(
      fresh,
      schemaManifest,
      'src/db/schema-manifest.js is stale. Run `pnpm run db:manifest` after changing schema.js or adding a migration.'
    );
  } finally {
    db.close();
  }
});

test('production-style verification accepts a migrated database and names what a stale one lacks', () => {
  const db = openTestDatabase();
  try {
    assert.deepEqual(verifySchema(db), { ok: true, expectedVersion: latestVersion, missing: [] });
    const stale = verifySchema(db, {
      version: latestVersion + 1,
      tables: { ...schemaManifest.tables, companies: [...schemaManifest.tables.companies, 'future_column'], future_table: ['id'] },
      indexes: [...schemaManifest.indexes, 'idx_future_unique'],
    });
    assert.equal(stale.ok, false);
    assert.deepEqual(stale.missing, ['companies.future_column', 'future_table', 'index idx_future_unique']);
    assert.ok(schemaManifest.indexes.includes('idx_scoring_versions_one_approved'), 'the integrity-critical partial unique index must be part of the manifest');
  } finally {
    db.close();
  }
});
