export const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA wal_autocheckpoint = 1000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT 'read,write,admin',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  domain TEXT,
  website_url TEXT,
  linkedin_url TEXT,
  industry TEXT NOT NULL DEFAULT 'Unknown',
  subindustry TEXT,
  employee_count INTEGER,
  size_band TEXT,
  annual_revenue REAL,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'US',
  status TEXT NOT NULL DEFAULT 'prospect',
  monitoring_tier TEXT NOT NULL DEFAULT 'universe',
  fit_score REAL NOT NULL DEFAULT 50,
  need_score REAL NOT NULL DEFAULT 0,
  intent_score REAL NOT NULL DEFAULT 0,
  timing_score REAL NOT NULL DEFAULT 0,
  risk_score REAL NOT NULL DEFAULT 0,
  opportunity_score REAL NOT NULL DEFAULT 0,
  opportunity_tier TEXT NOT NULL DEFAULT 'cold',
  owner_name TEXT,
  crm_id TEXT,
  last_observed_at TEXT,
  next_refresh_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_companies_tenant_score ON companies(tenant_id, opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_companies_tenant_tier ON companies(tenant_id, opportunity_tier, monitoring_tier);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(tenant_id, normalized_name);

CREATE TABLE IF NOT EXISTS company_aliases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias_type TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, alias_type, normalized_value)
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  title TEXT,
  seniority TEXT,
  department TEXT,
  email TEXT,
  linkedin_url TEXT,
  phone TEXT,
  is_decision_maker INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0.5,
  source TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_people_company ON people(tenant_id, company_id, is_decision_maker DESC);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.7,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_ref TEXT,
  UNIQUE(tenant_id, source, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_observations_company_time ON observations(tenant_id, company_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_type_time ON observations(tenant_id, type, observed_at DESC);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  signal_key TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  dimension TEXT NOT NULL,
  polarity INTEGER NOT NULL DEFAULT 1,
  base_weight REAL NOT NULL,
  strength REAL NOT NULL DEFAULT 1,
  confidence REAL NOT NULL,
  contribution REAL NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  source_count INTEGER NOT NULL DEFAULT 1,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, company_id, signal_key)
);

CREATE INDEX IF NOT EXISTS idx_signals_company ON signals(tenant_id, company_id, status, contribution DESC);
CREATE INDEX IF NOT EXISTS idx_signals_recent ON signals(tenant_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS signal_evidence (
  signal_id TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY(signal_id, observation_id)
);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  offer TEXT NOT NULL,
  headline TEXT NOT NULL,
  rationale TEXT NOT NULL,
  outreach_angle TEXT NOT NULL,
  proof_points_json TEXT NOT NULL DEFAULT '[]',
  next_action TEXT NOT NULL,
  generated_by TEXT NOT NULL DEFAULT 'rules',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, company_id)
);

CREATE TABLE IF NOT EXISTS lead_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  note TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  outcome_type TEXT NOT NULL,
  signal_key TEXT,
  score_at_outcome REAL NOT NULL,
  amount REAL,
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outcomes_company ON outcomes(tenant_id, company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_type ON outcomes(tenant_id, outcome_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  cadence TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  configured INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'needs_configuration',
  config_json TEXT NOT NULL DEFAULT '{}',
  last_run_at TEXT,
  next_run_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, connector_key)
);

CREATE TABLE IF NOT EXISTS connector_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_inserted INTEGER NOT NULL DEFAULT 0,
  signals_created INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_connector_runs ON connector_runs(tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events ON audit_events(tenant_id, created_at DESC);

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
`;
