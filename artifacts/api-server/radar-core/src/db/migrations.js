const migrations = [
  {
    version: 2,
    run(db) {
      addColumn(db, 'companies', 'identity_confidence', 'REAL NOT NULL DEFAULT 0.5');
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
          confidence REAL NOT NULL,
          incoming_name TEXT,
          incoming_domain TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_resolution_review ON entity_resolution_events(tenant_id, confidence, created_at DESC);
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
          opportunity_score REAL NOT NULL,
          opportunity_tier TEXT NOT NULL,
          fit_score REAL NOT NULL,
          need_score REAL NOT NULL,
          intent_score REAL NOT NULL,
          timing_score REAL NOT NULL,
          risk_score REAL NOT NULL,
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
    run(db) {
      // Sequential ingestion already treats provider IDs as immutable. Remove only
      // legacy race duplicates before enforcing that invariant at the database layer.
      db.exec(`
        DELETE FROM observations WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY tenant_id, source, type, external_id
              ORDER BY ingested_at ASC, id ASC
            ) duplicate_number
            FROM observations
            WHERE external_id IS NOT NULL
          ) WHERE duplicate_number > 1
        );
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

        INSERT OR IGNORE INTO company_source_identities(id, tenant_id, company_id, source, identity_type, normalized_value, created_at)
          SELECT 'source_identity_' || lower(hex(randomblob(16))), tenant_id, company_id, source, 'name', normalized_value, created_at
          FROM company_aliases WHERE alias_type='name' AND source IS NOT NULL;
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
        UPDATE companies
          SET identity_review_status=CASE
            WHEN identity_confidence < 0.8 OR domain IS NULL OR opportunity_tier='suppressed' THEN 'needs_review'
            ELSE 'unreviewed'
          END
          WHERE identity_review_status='unreviewed';
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
  }
];
/*
const migrations = [
  {
    version: 2,
    run(db) {
      addColumn(db, 'companies', 'identity_confidence', 'REAL NOT NULL DEFAULT 0.5');
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
          confidence REAL NOT NULL,
          incoming_name TEXT,
          incoming_domain TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_resolution_review ON entity_resolution_events(tenant_id, confidence, created_at DESC);
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
          opportunity_score REAL NOT NULL,
          opportunity_tier TEXT NOT NULL,
          fit_score REAL NOT NULL,
          need_score REAL NOT NULL,
          intent_score REAL NOT NULL,
          timing_score REAL NOT NULL,
          risk_score REAL NOT NULL,
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
    run(db) {
      // Sequential ingestion already treats provider IDs as immutable. Remove only
      // legacy race duplicates before enforcing that invariant at the database layer.
      db.exec(`
        DELETE FROM observations WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY tenant_id, source, type, external_id
              ORDER BY ingested_at ASC, id ASC
            ) duplicate_number
            FROM observations
            WHERE external_id IS NOT NULL
          ) WHERE duplicate_number > 1
        );
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

        INSERT OR IGNORE INTO company_source_identities(id, tenant_id, company_id, source, identity_type, normalized_value, created_at)
          SELECT 'source_identity_' || lower(hex(randomblob(16))), tenant_id, company_id, source, 'name', normalized_value, created_at
          FROM company_aliases WHERE alias_type='name' AND source IS NOT NULL;
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
  }
];
*/

export function applyMigrations(db) {
  for (const migration of migrations) {
    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(migration.version);
    if (applied) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.run(db);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function addColumn(db, table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
