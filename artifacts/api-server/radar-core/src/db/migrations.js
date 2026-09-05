import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaManifest } from './schema-manifest.js';

/**
 * Schema history. Each entry has:
 * - `run(db)`   schema (DDL) changes, portable across SQLite and Postgres;
 * - `before(db)` optional data-only steps that must precede the DDL
 *   (for example removing duplicates before a unique index is created);
 * - `after(db)`  optional data-only steps that follow the DDL (backfills).
 *
 * Outside production every step runs on open. In production the DDL is owned
 * by the publish flow (the development schema is copied to the production
 * database), so only `before`/`after` steps run there, once the live schema
 * has been verified against schema-manifest.json.
 */
const migrations = [
  {
    version: 2,
    run(db) {
      addColumn(db, 'companies', 'identity_confidence', 'DOUBLE PRECISION NOT NULL DEFAULT 0.5');
      addColumn(db, 'companies', 'identity_method', "TEXT NOT NULL DEFAULT 'unverified'");
      addColumn(db, 'observations', 'retrieved_at', 'TEXT');
      addColumn(db, 'observations', 'normalizer_version', "TEXT NOT NULL DEFAULT 'canonical-v1'");
      addColumn(db, 'observations', 'event_time_quality', "TEXT NOT NULL DEFAULT 'reported'");
      addColumn(db, 'connectors', 'consecutive_failures', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'connectors', 'backoff_until', 'TEXT');
      addColumn(db, 'connector_runs', 'records_rejected', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'connector_runs', 'duration_ms', 'INTEGER');
      addColumn(db, 'connector_runs', 'provider_cursor_json', "TEXT NOT NULL DEFAULT '{}'");
      db.exec(`
        CREATE TABLE IF NOT EXISTS ingestion_rejections (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          source TEXT,
          record_index INTEGER,
          error_code TEXT NOT NULL,
          error_message TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          connector_run_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ingestion_rejections_time ON ingestion_rejections(tenant_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS entity_resolution_events (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          source TEXT NOT NULL,
          method TEXT NOT NULL,
          confidence DOUBLE PRECISION NOT NULL,
          incoming_name TEXT,
          incoming_domain TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_resolution_review ON entity_resolution_events(tenant_id, confidence, created_at DESC);
      `);
    },
    after(db) {
      db.exec(`
        DELETE FROM connector_runs WHERE connector_key='demo';
        DELETE FROM connectors WHERE connector_key='demo';
        DELETE FROM companies WHERE domain LIKE '%.example';
      `);
    }
  },
  {
    version: 3,
    run(db) {
      addColumn(db, 'companies', 'score_version', "TEXT NOT NULL DEFAULT 'rules-1.0'");
      db.exec(`
        CREATE TABLE IF NOT EXISTS score_snapshots (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          score_version TEXT NOT NULL,
          opportunity_score DOUBLE PRECISION NOT NULL,
          opportunity_tier TEXT NOT NULL,
          fit_score DOUBLE PRECISION NOT NULL,
          need_score DOUBLE PRECISION NOT NULL,
          intent_score DOUBLE PRECISION NOT NULL,
          timing_score DOUBLE PRECISION NOT NULL,
          risk_score DOUBLE PRECISION NOT NULL,
          active_signal_count INTEGER NOT NULL,
          components_json TEXT NOT NULL DEFAULT '{}',
          computed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_score_snapshots_company ON score_snapshots(tenant_id, company_id, computed_at DESC);
      `);
    }
  },
  {
    version: 4,
    // Sequential ingestion already treats provider IDs as immutable. Remove only
    // legacy race duplicates before enforcing that invariant at the database layer.
    before(db) {
      db.exec(`
        DELETE FROM observations WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY tenant_id, source, type, external_id
              ORDER BY ingested_at ASC, id ASC
            ) duplicate_number
            FROM observations
            WHERE external_id IS NOT NULL
          ) ranked WHERE duplicate_number > 1
        );
      `);
    },
    run(db) {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_external_id
          ON observations(tenant_id, source, type, external_id)
          WHERE external_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_observations_source_time
          ON observations(tenant_id, source, observed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_companies_refresh
          ON companies(tenant_id, next_refresh_at);

        CREATE TABLE IF NOT EXISTS webhook_receipts (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          signature_hash TEXT NOT NULL,
          received_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          UNIQUE(tenant_id, signature_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_receipts_expiry
          ON webhook_receipts(expires_at);
      `);
    }
  },
  {
    version: 5,
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS company_source_identities (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          source TEXT NOT NULL,
          identity_type TEXT NOT NULL,
          normalized_value TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(tenant_id, company_id, source, identity_type, normalized_value)
        );
        CREATE INDEX IF NOT EXISTS idx_source_identity_lookup
          ON company_source_identities(tenant_id, source, identity_type, normalized_value);
      `);
    },
    after(db) {
      db.exec(`
        INSERT INTO company_source_identities(id, tenant_id, company_id, source, identity_type, normalized_value, created_at)
          SELECT 'source_identity_' || ${db.sql.randomHex()}, tenant_id, company_id, source, 'name', normalized_value, created_at
          FROM company_aliases WHERE alias_type='name' AND source IS NOT NULL
          ON CONFLICT DO NOTHING;
      `);
    }
  },
  {
    version: 6,
    run(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_companies_review
          ON companies(tenant_id, identity_confidence, opportunity_tier);
        CREATE INDEX IF NOT EXISTS idx_observations_ingested
          ON observations(tenant_id, ingested_at DESC);
        CREATE INDEX IF NOT EXISTS idx_signals_status_time
          ON signals(tenant_id, status, last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS idx_connectors_due
          ON connectors(enabled, next_run_at, backoff_until);
      `);
    }
  },
  {
    version: 7,
    run(db) {
      addColumn(db, 'companies', 'identity_review_status', "TEXT NOT NULL DEFAULT 'unreviewed'");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_companies_identity_review
          ON companies(tenant_id, identity_review_status, identity_confidence);
        CREATE TABLE IF NOT EXISTS identity_review_actions (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          note TEXT,
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_identity_review_actions_company
          ON identity_review_actions(tenant_id, company_id, created_at DESC);
      `);
    },
    after(db) {
      db.exec(`
        UPDATE companies
          SET identity_review_status=CASE
            WHEN identity_confidence < 0.8 OR domain IS NULL OR opportunity_tier='suppressed' THEN 'needs_review'
            ELSE 'unreviewed'
          END
          WHERE identity_review_status='unreviewed';
      `);
    }
  },
  {
    version: 8,
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scoring_versions (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          version TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('proposed', 'approved', 'superseded')),
          base_version TEXT NOT NULL,
          config_json TEXT NOT NULL,
          evaluation_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          approved_at TEXT,
          approved_by TEXT,
          UNIQUE(tenant_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_scoring_versions_status
          ON scoring_versions(tenant_id, status, created_at DESC);
      `);
    }
  },
  {
    version: 9,
    // Retain the most recently approved version if legacy data contains
    // competing active versions, then let the partial unique index enforce
    // that invariant for all future writes.
    before(db) {
      db.exec(`
        UPDATE scoring_versions
          SET status='superseded'
          WHERE id IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (
                PARTITION BY tenant_id
                ORDER BY approved_at DESC, created_at DESC, id DESC
              ) duplicate_number
              FROM scoring_versions
              WHERE status='approved'
            ) ranked WHERE duplicate_number > 1
          );
      `);
    },
    run(db) {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_scoring_versions_one_approved
          ON scoring_versions(tenant_id)
          WHERE status='approved';
      `);
    }
  },
  {
    version: 10,
    // Connector run leases: a due connector is claimed in the database so that
    // several API instances sharing one database never run it concurrently.
    // `lease_token` is the id of the claiming run, `lease_owner` the instance.
    run(db) {
      addColumn(db, 'connectors', 'lease_owner', 'TEXT');
      addColumn(db, 'connectors', 'lease_token', 'TEXT');
      addColumn(db, 'connectors', 'lease_expires_at', 'TEXT');
    }
  },
  {
    version: 11,
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS work_items (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          note TEXT,
          owner_name TEXT,
          due_at TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done', 'dismissed')),
          snoozed_until TEXT,
          resolution_note TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          updated_by TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_work_items_queue ON work_items(tenant_id, status, due_at);
        CREATE INDEX IF NOT EXISTS idx_work_items_company ON work_items(tenant_id, company_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS evidence_reviews (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK(status IN ('verified', 'rejected', 'needs_review')),
          note TEXT,
          reviewed_by TEXT NOT NULL,
          reviewed_at TEXT NOT NULL,
          UNIQUE(tenant_id, observation_id)
        );
        CREATE INDEX IF NOT EXISTS idx_evidence_reviews_status ON evidence_reviews(tenant_id, status, observation_id);
      `);
    }
  }
];


export const latestVersion = migrations[migrations.length - 1].version;

const manifestPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema-manifest.js');

export function applyMigrations(db) {
  recordBaseline(db);
  for (const migration of migrations) {
    if (isApplied(db, migration.version)) continue;
    db.transaction(() => {
      migration.before?.(db);
      migration.run(db);
      migration.after?.(db);
      recordVersion(db, migration.version);
    });
  }
}

/**
 * Production path: the DDL already exists (verified through the manifest), so
 * only data steps run and the version rows are recorded.
 */
export function recordManagedMigrations(db) {
  recordBaseline(db);
  for (const migration of migrations) {
    if (isApplied(db, migration.version)) continue;
    db.transaction(() => {
      migration.before?.(db);
      migration.after?.(db);
      recordVersion(db, migration.version);
    });
  }
}

export function currentVersion(db) {
  return db.get('SELECT MAX(version) version FROM schema_migrations')?.version || 0;
}

/**
 * Compares the live database with the checked-in manifest of tables, columns
 * and named indexes at the latest migration. Indexes matter as much as
 * columns: the partial unique indexes are what make single-active-score-version
 * and provider-ID idempotency hold under concurrency. Only missing objects
 * count: extra columns left behind by older experiments are harmless.
 */
export function verifySchema(db, manifest = schemaManifest) {
  const tables = new Set(db.tables());
  const missing = [];
  for (const [table, columns] of Object.entries(manifest.tables)) {
    if (!tables.has(table)) { missing.push(table); continue; }
    const present = new Set(db.columns(table));
    for (const column of columns) if (!present.has(column)) missing.push(`${table}.${column}`);
  }
  const indexes = new Set(db.indexes());
  for (const index of manifest.indexes || []) if (!indexes.has(index)) missing.push(`index ${index}`);
  return { ok: missing.length === 0, expectedVersion: manifest.version, missing };
}

export function buildManifest(db) {
  const tables = {};
  for (const table of [...db.tables()].sort()) tables[table] = [...db.columns(table)].sort();
  return { version: latestVersion, tables, indexes: [...db.indexes()].sort() };
}

export function writeManifest(manifest) {
  fs.writeFileSync(manifestPath, `// Generated by \`pnpm run db:manifest\`; do not edit by hand.
// Tables, columns and named indexes expected after migration ${manifest.version}. Production
// verifies the live database against this list instead of running DDL.
export const schemaManifest = ${JSON.stringify(manifest, null, 2)};
`);
  return manifestPath;
}

function isApplied(db, version) {
  return Boolean(db.get('SELECT 1 present FROM schema_migrations WHERE version=?', [version]));
}

function recordVersion(db, version) {
  db.run('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?) ON CONFLICT (version) DO NOTHING', [version, new Date().toISOString()]);
}

function recordBaseline(db) {
  if (!isApplied(db, 1)) recordVersion(db, 1);
}

function addColumn(db, table, name, definition) {
  if (!db.columns(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
