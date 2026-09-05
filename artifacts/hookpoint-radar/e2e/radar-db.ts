import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error The radar core is plain JavaScript without TS declarations.
import { openDatabase } from "../../api-server/radar-core/src/db/index.js";

/**
 * Direct access to the database behind the running API server, through the
 * radar core's own synchronous database boundary so the journey works whether
 * the server is on managed Postgres (DATABASE_URL, the default in this
 * workspace and in production) or on the embedded SQLite file.
 *
 * The browser journey only needs this for two things the product deliberately
 * does not expose over HTTP: resetting the dedicated e2e workspace so the run
 * is repeatable, and seeding the labeled-outcome history that score
 * calibration requires. Everything the operator does is driven through the UI.
 */

/** The subset of the radar core database boundary the journey uses. */
export interface RadarDatabase {
  dialect: "sqlite" | "postgres";
  run(sql: string, params?: unknown[]): { changes: number };
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  close(): void;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDatabasePath = path.resolve(here, "../../api-server/data/hookpoint-radar.sqlite");
// Keep snapshots and browser expectations aligned with the checked-in model.
export const DEFAULT_SCORING_VERSION: string = JSON.parse(
  fs.readFileSync(path.resolve(here, "../../api-server/radar-core/config/scoring.json"), "utf8"),
).version;

/**
 * Resolution order mirrors the API server: E2E_DATABASE_URL, then the
 * workspace DATABASE_URL, then the SQLite file (E2E_DATABASE_PATH or the
 * default path). The schema is verified, never modified, from the test side.
 */
export function openRadarDatabase(): RadarDatabase {
  const target = process.env.E2E_DATABASE_URL
    || process.env.DATABASE_URL
    || (process.env.E2E_DATABASE_PATH ? path.resolve(process.env.E2E_DATABASE_PATH) : defaultDatabasePath);
  const db = openDatabase(target, { manageSchema: false }) as RadarDatabase & { schemaStatus: { ok: boolean; missing: string[] } };
  if (!db.schemaStatus.ok) {
    db.close();
    throw new Error(
      `Radar database at ${describeTarget(target)} is missing ${db.schemaStatus.missing.slice(0, 3).join(", ")}. Start the API Server workflow first so it applies the schema.`,
    );
  }
  return db;
}

function describeTarget(target: string): string {
  return /^postgres/i.test(target) ? "DATABASE_URL (Postgres)" : target;
}

/**
 * Removes every row that belongs to the e2e tenant. Child tables cascade from
 * `tenants`, and the API recreates the private workspace on the next
 * authenticated request, so this leaves the account in a first-sign-in state.
 */
export function resetTenant(db: RadarDatabase, tenantId: string): void {
  db.run("DELETE FROM tenants WHERE id = ?", [tenantId]);
}

export function tenantExists(db: RadarDatabase, tenantId: string): boolean {
  return db.get("SELECT 1 present FROM tenants WHERE id = ?", [tenantId]) !== undefined;
}

export interface CalibrationCohortOptions {
  /** Prefix for seeded ids so a run's rows are recognisable in the shared dev database. */
  runId: string;
  /** Number of labeled accounts. The default clears every calibration guardrail. */
  size?: number;
}

/**
 * Seeds labeled outcomes with historic score snapshots so the calibration
 * evaluator can propose a new score version. Mirrors the deterministic cohort
 * used by the API server's own regression tests: the most recent quarter of
 * labels (the holdout) has a different qualification pattern than the training
 * rows, and fit/need components separate the classes so the proposal clears
 * the AUC-lift guardrail.
 */
export function seedCalibrationCohort(
  db: RadarDatabase,
  tenantId: string,
  { runId, size = 120 }: CalibrationCohortOptions,
): void {
  if (!tenantExists(db, tenantId)) {
    throw new Error(
      `Tenant ${tenantId} does not exist yet. Make one authenticated request before seeding calibration data.`,
    );
  }
  const insertCompany = `INSERT INTO companies(id, tenant_id, name, normalized_name, domain, opportunity_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const insertSnapshot = `INSERT INTO score_snapshots(id, tenant_id, company_id, score_version, opportunity_score, opportunity_tier,
       fit_score, need_score, intent_score, timing_score, risk_score, active_signal_count, components_json, computed_at)
     VALUES (?, ?, ?, ?, 10, 'cold', ?, ?, 0, 0, 0, 0, '{}', ?)`;
  const insertOutcome = `INSERT INTO outcomes(id, tenant_id, company_id, outcome_type, score_at_outcome, metadata_json, occurred_at, created_at)
     VALUES (?, ?, ?, ?, 10, '{}', ?, ?)`;
  const holdoutStart = Math.floor(size * 0.75);
  const now = new Date().toISOString();

  db.transaction(() => {
    for (let index = 0; index < size; index += 1) {
      const companyId = `${runId}-calibration-${index}`;
      const name = `E2E calibration ${index} (${runId})`;
      const occurredAt = new Date(Date.UTC(2021, 0, index + 1)).toISOString();
      const scoredAt = new Date(Date.parse(occurredAt) - 1_000).toISOString();
      const qualified = index >= holdoutStart ? index % 2 === 0 : index % 3 === 0;
      db.run(insertCompany, [companyId, tenantId, name, name.toLowerCase(), `${companyId}.example.com`, 10, now, now]);
      // These legacy outcome rows have no provenance metadata. They remain
      // calibration-eligible because a matching score exists before the event.
      db.run(insertSnapshot, [`${companyId}-snapshot`, tenantId, companyId, DEFAULT_SCORING_VERSION, qualified ? 0 : 100, qualified ? 70 : 0, scoredAt]);
      db.run(insertOutcome, [`${companyId}-outcome`, tenantId, companyId, qualified ? "meeting" : "lost", occurredAt, now]);
    }
  });
}

export interface ScoringVersionRow {
  id: string;
  version: string;
  status: string;
  base_version: string;
  config_json: string;
  evaluation_json: string;
  approved_by: string | null;
}

export function getScoringVersion(db: RadarDatabase, tenantId: string, id: string): ScoringVersionRow | undefined {
  return db.get<ScoringVersionRow>(
    `SELECT id, version, status, base_version, config_json, evaluation_json, approved_by
     FROM scoring_versions WHERE tenant_id = ? AND id = ?`,
    [tenantId, id],
  );
}

export function getApprovedScoringVersion(db: RadarDatabase, tenantId: string): ScoringVersionRow | undefined {
  return db.get<ScoringVersionRow>(
    `SELECT id, version, status, base_version, config_json, evaluation_json, approved_by
     FROM scoring_versions WHERE tenant_id = ? AND status = 'approved'`,
    [tenantId],
  );
}

/**
 * Simulates a second administrator activating an independently reviewed score
 * version while the browser still shows an older proposal. The activated
 * version keeps the *baseline* weights the proposal was evaluated against, so a
 * fresh evaluation afterwards can still find the same lift; only the active
 * version name changes, which is exactly what makes the on-screen proposal
 * stale.
 */
export function activateIndependentScoringVersion(
  db: RadarDatabase,
  tenantId: string,
  staleProposal: ScoringVersionRow,
  { runId, actor }: { runId: string; actor: string },
): string {
  const candidate = JSON.parse(staleProposal.config_json) as {
    dimensionWeights: Record<string, number>;
    [key: string]: unknown;
  };
  const evaluation = JSON.parse(staleProposal.evaluation_json) as {
    explanation: Array<{ dimension: string; before: number; after: number }>;
  };
  // The explanation only lists dimensions whose weight moved; unchanged
  // dimensions already carry the baseline weight in the candidate config.
  const baselineWeights = {
    ...candidate.dimensionWeights,
    ...Object.fromEntries(evaluation.explanation.map((weight) => [weight.dimension, weight.before])),
  };
  const version = `${staleProposal.base_version}-independent-review-${runId}`;
  const config = { ...candidate, version, dimensionWeights: baselineWeights };
  const now = new Date().toISOString();
  const id = `score_version_${runId}_independent`;
  db.run(
    `INSERT INTO scoring_versions(id, tenant_id, version, status, base_version, config_json, evaluation_json,
       created_at, created_by, approved_at, approved_by)
     VALUES (?, ?, ?, 'approved', ?, ?, '{}', ?, ?, ?, ?)`,
    [id, tenantId, version, staleProposal.base_version, JSON.stringify(config), now, actor, now, actor],
  );
  return version;
}
