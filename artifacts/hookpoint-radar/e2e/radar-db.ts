import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/**
 * Direct access to the SQLite database behind the running API server.
 *
 * The browser journey only needs this for two things the product deliberately
 * does not expose over HTTP: resetting the dedicated e2e workspace so the run
 * is repeatable, and seeding the labeled-outcome history that score
 * calibration requires. Everything the operator does is driven through the UI.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDatabasePath = path.resolve(here, "../../api-server/data/hookpoint-radar.sqlite");

export function openRadarDatabase(): DatabaseSync {
  const databasePath = process.env.E2E_DATABASE_PATH
    ? path.resolve(process.env.E2E_DATABASE_PATH)
    : defaultDatabasePath;
  if (!fs.existsSync(databasePath)) {
    throw new Error(
      `Radar database not found at ${databasePath}. Start the API Server workflow first or set E2E_DATABASE_PATH.`,
    );
  }
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

/**
 * Removes every row that belongs to the e2e tenant. Child tables cascade from
 * `tenants`, and the API recreates the private workspace on the next
 * authenticated request, so this leaves the account in a first-sign-in state.
 */
export function resetTenant(db: DatabaseSync, tenantId: string): void {
  db.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
}

export function tenantExists(db: DatabaseSync, tenantId: string): boolean {
  return db.prepare("SELECT 1 FROM tenants WHERE id = ?").get(tenantId) !== undefined;
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
  db: DatabaseSync,
  tenantId: string,
  { runId, size = 120 }: CalibrationCohortOptions,
): void {
  if (!tenantExists(db, tenantId)) {
    throw new Error(
      `Tenant ${tenantId} does not exist yet. Make one authenticated request before seeding calibration data.`,
    );
  }
  const insertCompany = db.prepare(
    `INSERT INTO companies(id, tenant_id, name, normalized_name, domain, opportunity_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSnapshot = db.prepare(
    `INSERT INTO score_snapshots(id, tenant_id, company_id, score_version, opportunity_score, opportunity_tier,
       fit_score, need_score, intent_score, timing_score, risk_score, active_signal_count, components_json, computed_at)
     VALUES (?, ?, ?, 'rules-1.1', 0, 'cold', ?, ?, 0, 0, 0, 0, '{}', ?)`,
  );
  const insertOutcome = db.prepare(
    `INSERT INTO outcomes(id, tenant_id, company_id, outcome_type, score_at_outcome, metadata_json, occurred_at, created_at)
     VALUES (?, ?, ?, ?, 10, '{}', ?, ?)`,
  );
  const holdoutStart = Math.floor(size * 0.75);
  const now = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < size; index += 1) {
      const companyId = `${runId}-calibration-${index}`;
      const name = `E2E calibration ${index} (${runId})`;
      const occurredAt = new Date(Date.UTC(2021, 0, index + 1)).toISOString();
      const qualified = index >= holdoutStart ? index % 2 === 0 : index % 3 === 0;
      insertCompany.run(companyId, tenantId, name, name.toLowerCase(), `${companyId}.example.com`, 10, now, now);
      insertSnapshot.run(`${companyId}-snapshot`, tenantId, companyId, qualified ? 0 : 100, qualified ? 70 : 0, occurredAt);
      insertOutcome.run(`${companyId}-outcome`, tenantId, companyId, qualified ? "meeting" : "lost", occurredAt, now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

export function getScoringVersion(db: DatabaseSync, tenantId: string, id: string): ScoringVersionRow | undefined {
  return db
    .prepare(
      `SELECT id, version, status, base_version, config_json, evaluation_json, approved_by
       FROM scoring_versions WHERE tenant_id = ? AND id = ?`,
    )
    .get(tenantId, id) as ScoringVersionRow | undefined;
}

export function getApprovedScoringVersion(db: DatabaseSync, tenantId: string): ScoringVersionRow | undefined {
  return db
    .prepare(
      `SELECT id, version, status, base_version, config_json, evaluation_json, approved_by
       FROM scoring_versions WHERE tenant_id = ? AND status = 'approved'`,
    )
    .get(tenantId) as ScoringVersionRow | undefined;
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
  db: DatabaseSync,
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
  db.prepare(
    `INSERT INTO scoring_versions(id, tenant_id, version, status, base_version, config_json, evaluation_json,
       created_at, created_by, approved_at, approved_by)
     VALUES (?, ?, ?, 'approved', ?, ?, '{}', ?, ?, ?, ?)`,
  ).run(id, tenantId, version, staleProposal.base_version, JSON.stringify(config), now, actor, now, actor);
  return version;
}
