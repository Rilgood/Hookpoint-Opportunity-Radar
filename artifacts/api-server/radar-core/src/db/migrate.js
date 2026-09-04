#!/usr/bin/env node
// Applies schema.js and every pending migration to the configured store
// (DATABASE_URL when set, otherwise DATABASE_PATH). Refuses to run in production.
//
// Used by scripts/post-merge.sh so the development database always carries
// the latest schema for the publish flow to copy to production, and by
// operators who run radar-core against a Postgres they manage themselves.
import { config } from '../config.js';
import { openDatabase } from './index.js';
import { currentVersion } from './migrations.js';

if (config.env === 'production') {
  console.error('db:migrate refuses to run with NODE_ENV=production: the published API never applies DDL. Migrate the development database and publish so the schema is copied across.');
  process.exit(2);
}

const db = openDatabase(config.databaseTarget, { manageSchema: true });
try {
  console.log(JSON.stringify({
    event: 'schema_applied',
    storage_mode: config.storageMode,
    schema: db.schemaName,
    schema_version: currentVersion(db),
  }));
} finally {
  db.close();
}
