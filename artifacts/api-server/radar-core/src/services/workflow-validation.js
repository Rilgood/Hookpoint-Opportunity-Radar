import { AppError, isPlainObject } from '../lib.js';

export function validateFields(input, allowed) {
  if (!isPlainObject(input)) throw new AppError(400, 'invalid_workflow_input', 'Provide a JSON object.');
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new AppError(400, 'unknown_workflow_fields', `Unsupported fields: ${unknown.join(', ')}.`);
}

export function workflowText(value, field, maximum, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.trim().length > maximum || (required && !value.trim())) {
    throw new AppError(400, `invalid_${field}`, `${field} must be ${required ? 'nonblank text' : 'text or null'} of at most ${maximum} characters.`);
  }
  return value.trim() || null;
}

export function workflowDate(value, field) {
  if (value == null) return null;
  // Require an explicit timezone rather than silently interpreting local input
  // in the server's timezone. Reject rolled-over dates such as February 30.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new AppError(400, `invalid_${field}`, `${field} must be an ISO timestamp with a timezone, or null.`);
  }
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  const [, year, month, day, hour, minute, second = '0'] = parts.map((part, index) => index ? Number(part) : part);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const parsed = new Date(value);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || !Number.isFinite(parsed.getTime())) {
    throw new AppError(400, `invalid_${field}`, `${field} must be a valid timestamp.`);
  }
  return parsed.toISOString();
}

export function workflowPagination(query) {
  const number = (key, fallback, minimum, maximum) => {
    if (query[key] == null || query[key] === '') return fallback;
    const value = Number(query[key]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw new AppError(400, `invalid_${key}`, `${key} must be an integer between ${minimum} and ${maximum}.`);
    return value;
  };
  return { limit: number('limit', 50, 1, 200), offset: number('offset', 0, 0, 1_000_000) };
}

export function requireWorkflowCompany(db, tenantId, companyId) {
  const company = db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
  if (!company) throw new AppError(404, 'company_not_found', 'Company not found.');
  return company;
}

export const closedCompanyStatuses = new Set(['rejected', 'customer', 'lost', 'disqualified']);
