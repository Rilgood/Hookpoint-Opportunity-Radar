import { config, runtimeIssues } from '../config.js';
import { nowIso } from '../lib.js';
import { connectorCatalog } from './catalog.js';
import { implementedConnectorKeys } from '../connectors/index.js';
import { hasGoogleSheetsTenantBinding } from '../connectors/google-sheets.js';
import { outcomeAnalytics } from './outcomes.js';
import { currentVersion } from '../db/migrations.js';

const guidance = {
  gdelt: ['Market coverage', 'Find recent coverage of a named company. News coverage alone does not establish buying intent.', ['Company name or domain', 'Optional search query']],
  newsapi: ['Market coverage', 'Collect dated coverage for a specific company. Review relevance before treating an article as evidence.', ['Company name or domain', 'Optional search query']],
  google_sheets: ['Your existing research', 'Import rows from a sheet explicitly bound to this workspace. The managed Google connection and sheet access must be provisioned on the server.', ['Authorized spreadsheet URL or ID', 'Sheet range', 'Columns: type, title, company_name or company_domain']],
  generic_webhook: ['First-party events', 'Receive signed observations from your systems. Both an API key for this workspace and a valid event signature are required.', ['POST /api/v1/webhooks/{source}', 'Workspace API key', 'Timestamp and HMAC signature']],
  sec_edgar: ['Public company filings', 'Track filings by SEC registrant ID. A filing is a dated event, not proof of a new budget.', ['Company CIK', 'Optional date range']],
  nppes: ['Healthcare identity', 'Enrich organization identity from NPI-2 records. Registry presence is firmographic information, not buying intent.', ['Organization name or NPI', 'Optional US state']],
  usa_spending: ['Federal award events', 'Track contract and grant awards for a named recipient. Confirm the recipient identity before taking action.', ['Company name', 'Optional date range']],
};

/** Read-only, tenant-scoped proof of progress. Environment values never leave the server. */
export function workspaceReadiness(db, tenantId) {
  const asOf = nowIso();
  const count = (table, extra = '') => Number(db.get(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=? ${extra}`, [tenantId])?.count || 0);
  const rows = new Map(db.all('SELECT connector_key,enabled,status,last_run_at FROM connectors WHERE tenant_id=?', [tenantId]).map((row) => [row.connector_key, row]));
  const runs = db.all('SELECT connector_key,status,finished_at,records_seen,records_inserted,records_rejected FROM connector_runs WHERE tenant_id=? ORDER BY started_at DESC', [tenantId]);
  const latestRuns = new Map();
  for (const run of runs) if (!latestRuns.has(run.connector_key)) latestRuns.set(run.connector_key, run);
  const sources = connectorCatalog.map((item) => {
    const row = rows.get(item.key);
    const implemented = implementedConnectorKeys.has(item.key);
    const requirements = [item.keyEnv, item.actorEnv].filter(Boolean).map((name) => ({
      name,
      present: item.key === 'google_sheets' ? hasGoogleSheetsTenantBinding(tenantId)
        : name === 'CONNECTOR_WEBHOOK_SECRET' ? config.webhookSecret.length >= 32 : Boolean(String(process.env[name] || '').trim()),
    }));
    const configured = requirements.every((requirement) => requirement.present);
    const [purpose, description, inputs] = guidance[item.key] || (item.key.startsWith('apify_')
      ? ['Public research', 'Use your chosen actor and its input schema. Review collected records and source dates before making a business decision.', ['Actor-specific input JSON', ...(item.key === 'apify_google_search' ? ['Target company name or domain'] : ['Optional target company identity'])]]
      : ['Planned integration', 'This provider is catalogued, but its native adapter has not been implemented. Use the signed webhook or authorized Sheets import to bring equivalent observations into the workspace.', []]);
    const latest = latestRuns.get(item.key);
    return { key: item.key, label: item.label, purpose, description, inputs, implemented, configured,
      enabled: Boolean(row?.enabled && configured), mode: item.mode, cadence: item.cadence,
      status: !implemented ? 'adapter_pending' : !configured ? 'needs_configuration' : row?.status || 'disabled',
      requirements, latest_run: latest ? { status: latest.status, finished_at: latest.finished_at,
        seen: Number(latest.records_seen), inserted: Number(latest.records_inserted), rejected: Number(latest.records_rejected) } : null };
  });
  const counts = {
    companies: count('companies'), observations: count('observations'), reviewed_evidence: count('evidence_reviews', "AND status IN ('verified','rejected')"),
    work_items: count('work_items'), assigned_work: count('work_items', "AND owner_name IS NOT NULL AND TRIM(owner_name)<>'' AND due_at IS NOT NULL"),
    completed_work: count('work_items', "AND status='done'"), outcomes: count('outcomes'),
    pending_identity: count('companies', "AND identity_review_status!='confirmed' AND identity_confidence<0.8"),
  };
  const calibration = outcomeAnalytics(db, tenantId).calibration.summary;
  const issues = runtimeIssues(db);
  return { as_of: asOf, mode: process.env.HOOKPOINT_LOCAL_DEMO === 'true' && config.env === 'development' ? 'local' : config.env,
    runtime: { ready: !issues.some((issue) => issue.severity === 'critical'), schema_version: currentVersion(db),
      storage_mode: config.storageMode, authenticated: config.authRequired, scheduler_enabled: config.schedulerEnabled, issues },
    counts, sources, calibration,
    steps: [
      { key: 'collect', title: 'Bring in your first evidence', complete: counts.observations > 0, value: counts.observations, href: '/sources', detail: 'Connect one source, run a focused import, then check its run results.' },
      { key: 'review', title: 'Review the evidence', complete: counts.reviewed_evidence > 0, value: counts.reviewed_evidence, href: '/opportunities', detail: 'Open an account brief, check the source and date, and verify or reject the evidence.' },
      { key: 'act', title: 'Give the next action an owner', complete: counts.assigned_work > 0, value: counts.assigned_work, href: '/work-queue', detail: 'Save a concrete next step with an owner and due date. Your work queue keeps it visible.' },
      { key: 'learn', title: 'Record what happened', complete: counts.outcomes > 0, value: counts.outcomes, href: '/insights', detail: 'Record real replies, meetings and won or lost opportunities from the account brief.' },
    ] };
}
