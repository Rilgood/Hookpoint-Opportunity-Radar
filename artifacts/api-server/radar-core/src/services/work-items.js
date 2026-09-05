import { AppError, id, nowIso } from '../lib.js';
import { recordAudit } from './audit.js';
import { closedCompanyStatuses, requireWorkflowCompany, validateFields, workflowDate, workflowPagination, workflowText } from './workflow-validation.js';

const mutableFields = ['title', 'note', 'owner_name', 'due_at', 'status', 'snoozed_until', 'resolution_note'];
const itemSelect = `SELECT w.*, c.name company_name, c.status company_status, r.next_action suggested_next_action
  FROM work_items w JOIN companies c ON c.id=w.company_id AND c.tenant_id=w.tenant_id
  LEFT JOIN recommendations r ON r.company_id=w.company_id AND r.tenant_id=w.tenant_id`;

export function createWorkItem(db, tenantId, input, actor = 'operator', requestId = null) {
  validateFields(input, ['company_id', 'title', 'note', 'owner_name', 'due_at']);
  const companyId = workflowText(input.company_id, 'company_id', 200, true);
  const title = workflowText(input.title, 'title', 240, true);
  const note = workflowText(input.note, 'note', 2000);
  const dueAt = workflowDate(input.due_at, 'due_at');
  return db.transaction(() => {
    const company = requireWorkflowCompany(db, tenantId, companyId);
    assertOpenCompany(company);
    const owner = workflowText(Object.hasOwn(input, 'owner_name') ? input.owner_name : company.owner_name, 'owner_name', 200);
    const now = nowIso();
    const workId = id('work');
    const by = String(actor).slice(0, 200);
    db.run(`INSERT INTO work_items(id, tenant_id, company_id, title, note, owner_name, due_at, status, created_at, updated_at, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`, [workId, tenantId, companyId, title, note, owner, dueAt, now, now, by, by]);
    const item = getWorkItem(db, tenantId, workId);
    recordAudit(db, tenantId, { action: 'work_item.created', actor, resourceType: 'work_item', resourceId: workId, requestId, details: { company_id: companyId, title, owner_name: owner, due_at: dueAt } });
    return item;
  });
}

export function updateWorkItem(db, tenantId, workId, input, actor = 'operator', requestId = null) {
  validateFields(input, mutableFields);
  if (!Object.keys(input).length) throw new AppError(400, 'empty_work_item_update', 'Provide at least one field to update.');
  return db.transaction(() => {
    const current = db.get(`SELECT * FROM work_items WHERE tenant_id=? AND id=?${db.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [tenantId, workId]);
    if (!current) throw new AppError(404, 'work_item_not_found', 'Work item not found.');
    const company = requireWorkflowCompany(db, tenantId, current.company_id);
    const next = { ...current };
    for (const field of ['title', 'note', 'owner_name', 'resolution_note']) {
      if (Object.hasOwn(input, field)) next[field] = workflowText(input[field], field, field === 'title' ? 240 : field === 'owner_name' ? 200 : 2000, field === 'title');
    }
    for (const field of ['due_at', 'snoozed_until']) if (Object.hasOwn(input, field)) next[field] = workflowDate(input[field], field);
    if (Object.hasOwn(input, 'status')) {
      if (!['open', 'done', 'dismissed'].includes(input.status)) throw new AppError(400, 'invalid_work_item_status', 'status must be open, done, or dismissed.');
      next.status = input.status;
    }
    const now = nowIso();
    if (next.status === 'open' && current.status !== 'open') {
      assertOpenCompany(company);
      next.completed_at = null;
      next.resolution_note = null;
      if (!Object.hasOwn(input, 'snoozed_until')) next.snoozed_until = null;
    }
    if (next.status === 'dismissed' && (!next.resolution_note || (current.status !== 'dismissed' && !Object.hasOwn(input, 'resolution_note')))) throw new AppError(400, 'dismissal_reason_required', 'A resolution_note is required to dismiss a work item.');
    if (Object.hasOwn(input, 'snoozed_until') && next.snoozed_until) {
      if (next.status !== 'open') throw new AppError(400, 'cannot_snooze_closed_work_item', 'Reopen the work item before snoozing it.');
      assertOpenCompany(company);
      if (next.snoozed_until <= now) throw new AppError(400, 'invalid_snoozed_until', 'snoozed_until must be in the future.');
    }
    if (next.status !== 'open') {
      next.snoozed_until = null;
      next.completed_at = current.status === next.status ? current.completed_at : now;
    }
    next.updated_at = now;
    next.updated_by = String(actor).slice(0, 200);
    const fields = [...mutableFields, 'completed_at', 'updated_at', 'updated_by'];
    db.run(`UPDATE work_items SET ${fields.map((field) => `${field}=?`).join(', ')} WHERE tenant_id=? AND id=?`, [...fields.map((field) => next[field]), tenantId, workId]);
    recordAudit(db, tenantId, { action: 'work_item.updated', actor, resourceType: 'work_item', resourceId: workId, requestId,
      details: { company_id: current.company_id, changes: Object.fromEntries(fields.filter((field) => !['updated_at', 'updated_by'].includes(field) && current[field] !== next[field]).map((field) => [field, { from: current[field], to: next[field] }])) } });
    return getWorkItem(db, tenantId, workId);
  });
}

export function getWorkItem(db, tenantId, workId) {
  const row = db.get(`${itemSelect} WHERE w.tenant_id=? AND w.id=?`, [tenantId, workId]);
  if (!row) throw new AppError(404, 'work_item_not_found', 'Work item not found.');
  return present(row, nowIso());
}

export function listWorkItems(db, tenantId, query = {}) {
  const { limit, offset } = workflowPagination(query);
  const asOf = nowIso();
  const { timeZone, start, end } = localDay(query.time_zone || 'UTC', asOf);
  const view = query.view === 'done' ? 'completed' : query.view || 'open';
  const where = ['w.tenant_id=?'];
  const params = [tenantId];
  if (query.company_id) { requireWorkflowCompany(db, tenantId, query.company_id); where.push('w.company_id=?'); params.push(query.company_id); }
  if (query.owner_name) { where.push('LOWER(w.owner_name)=LOWER(?)'); params.push(workflowText(query.owner_name, 'owner_name', 200, true)); }
  if (query.q) {
    const q = workflowText(query.q, 'q', 240, true).replace(/[\\%_]/g, '\\$&');
    where.push("(LOWER(w.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(c.name) LIKE LOWER(?) ESCAPE '\\')");
    params.push(`%${q}%`, `%${q}%`);
  }
  const open = "w.status='open' AND (w.snoozed_until IS NULL OR w.snoozed_until<=?)";
  const views = {
    all: ['1=1', []], open: [open, [asOf]],
    due: [`${open} AND w.due_at<?`, [asOf, end]],
    today: [`${open} AND w.due_at>=? AND w.due_at<?`, [asOf, start, end]],
    upcoming: [`${open} AND w.due_at>=?`, [asOf, end]],
    overdue: [`${open} AND w.due_at<?`, [asOf, asOf]],
    snoozed: ["w.status='open' AND w.snoozed_until>?", [asOf]],
    completed: ["w.status='done'", []], dismissed: ["w.status='dismissed'", []]
  };
  if (!Object.hasOwn(views, view)) throw new AppError(400, 'invalid_work_item_view', 'Unknown work item view.');
  const from = 'FROM work_items w JOIN companies c ON c.id=w.company_id AND c.tenant_id=w.tenant_id';
  const countExpressions = Object.entries(views).map(([name, [condition]]) => `COALESCE(SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END), 0) "${name}"`);
  const countParams = Object.values(views).flatMap(([, values]) => values);
  const rawCounts = db.get(`SELECT ${countExpressions.join(', ')} ${from} WHERE ${where.join(' AND ')}`, [...countParams, ...params]);
  const counts = Object.fromEntries(Object.entries(rawCounts).map(([name, count]) => [name, Number(count)]));
  const [condition, values] = views[view];
  const rows = db.all(`${itemSelect} WHERE ${where.join(' AND ')} AND (${condition})
    ORDER BY CASE WHEN w.due_at IS NULL THEN 1 ELSE 0 END, w.due_at ASC, w.created_at DESC, w.id ASC LIMIT ? OFFSET ?`, [...params, ...values, limit, offset]);
  return { data: rows.map((row) => present(row, asOf)), total: counts[view], limit, offset, counts, as_of: asOf, time_zone: timeZone };
}

function present(row, asOf) {
  return { ...row, is_actionable: row.status === 'open' && (!row.snoozed_until || row.snoozed_until <= asOf) && !closedCompanyStatuses.has(row.company_status) };
}
function assertOpenCompany(company) {
  if (closedCompanyStatuses.has(company.status)) throw new AppError(409, 'company_workflow_closed', 'Reopen the account before creating or reopening work. Existing work can still be completed or dismissed.');
}

// Find actual local midnight boundaries, including 23/25-hour DST days. This
// avoids using the server timezone or assuming every calendar day is 24 hours.
function localDay(timeZone, asOf) {
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { throw new AppError(400, 'invalid_time_zone', 'time_zone must be a valid IANA timezone.'); }
  const dateKey = (instant) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const day = dateKey(asOf);
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const boundary = (key) => {
    const utc = Date.parse(`${key}T00:00:00Z`);
    let low = utc - 36 * 3_600_000, high = utc + 36 * 3_600_000;
    while (high - low > 1) { const mid = Math.floor((low + high) / 2); if (dateKey(mid) < key) low = mid; else high = mid; }
    return new Date(high).toISOString();
  };
  return { timeZone: formatter.resolvedOptions().timeZone, start: boundary(day), end: boundary(next) };
}
