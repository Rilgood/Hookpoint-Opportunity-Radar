import { AppError, id, nowIso } from '../lib.js';
import { recordAudit } from './audit.js';
import { rescoreCompany } from './signals.js';
import { requireWorkflowCompany, validateFields, workflowPagination, workflowText } from './workflow-validation.js';

const reviewStates = ['verified', 'rejected', 'needs_review'];

export function listEvidenceReviews(db, tenantId, companyId, query = {}) {
  requireWorkflowCompany(db, tenantId, companyId);
  const { limit, offset } = workflowPagination(query);
  const status = query.status || 'all';
  if (!['all', 'unreviewed', ...reviewStates].includes(status)) throw new AppError(400, 'invalid_evidence_review_status', 'Unknown evidence review status.');
  const where = ['o.tenant_id=?', 'o.company_id=?'];
  const params = [tenantId, companyId];
  if (status !== 'all') { where.push("COALESCE(r.status, 'unreviewed')=?"); params.push(status); }
  const from = `FROM observations o LEFT JOIN evidence_reviews r ON r.observation_id=o.id AND r.tenant_id=o.tenant_id WHERE ${where.join(' AND ')}`;
  const total = Number(db.get(`SELECT COUNT(*) count ${from}`, params).count);
  const data = db.all(`SELECT o.id observation_id, o.title, o.source, o.url, o.observed_at,
    COALESCE(r.status, 'unreviewed') status, r.note, r.reviewed_by, r.reviewed_at
    ${from} ORDER BY o.observed_at DESC, o.id ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { data, total, limit, offset };
}

export function reviewEvidence(db, tenantId, companyId, input, actor = 'operator', requestId = null) {
  validateFields(input, ['observation_id', 'status', 'note']);
  const observationId = workflowText(input.observation_id, 'observation_id', 200, true);
  if (!reviewStates.includes(input.status)) throw new AppError(400, 'invalid_evidence_review_status', 'status must be verified, rejected, or needs_review.');
  const note = workflowText(input.note, 'note', 2000, input.status !== 'verified');
  return db.transaction(() => {
    requireWorkflowCompany(db, tenantId, companyId);
    const observation = db.get('SELECT id FROM observations WHERE tenant_id=? AND company_id=? AND id=?', [tenantId, companyId, observationId]);
    if (!observation) throw new AppError(404, 'observation_not_found', 'Observation not found on this account.');
    const previous = db.get('SELECT status, note, reviewed_by, reviewed_at FROM evidence_reviews WHERE tenant_id=? AND observation_id=?', [tenantId, observationId]);
    const now = nowIso();
    db.run(`INSERT INTO evidence_reviews(id, tenant_id, observation_id, status, note, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, observation_id) DO UPDATE SET status=excluded.status, note=excluded.note, reviewed_by=excluded.reviewed_by, reviewed_at=excluded.reviewed_at`,
    [id('review'), tenantId, observationId, input.status, note, String(actor).slice(0, 200), now]);
    const company = rescoreCompany(db, tenantId, companyId);
    const review = db.get('SELECT observation_id, status, note, reviewed_by, reviewed_at FROM evidence_reviews WHERE tenant_id=? AND observation_id=?', [tenantId, observationId]);
    recordAudit(db, tenantId, { action: 'evidence.reviewed', actor, resourceType: 'observation', resourceId: observationId, requestId,
      details: { company_id: companyId, previous: previous || { status: 'unreviewed' }, review, excluded_from_scoring: input.status === 'rejected' } });
    return { review, company };
  });
}
