import { requireScope } from '../http/security.js';
import { createWorkItem, getWorkItem, listWorkItems, updateWorkItem } from './work-items.js';
import { listEvidenceReviews, reviewEvidence } from './evidence-reviews.js';

export function registerWorkflowRoutes(router, db) {
  router.get('/api/v1/work-items', async ({ auth, query }) => listWorkItems(db, auth.tenantId, query));
  router.get('/api/v1/work-items/:id', async ({ auth, params }) => getWorkItem(db, auth.tenantId, params.id));
  router.post('/api/v1/work-items', async ({ auth, body, requestId }) => {
    requireScope(auth, 'write');
    return { status: 201, data: createWorkItem(db, auth.tenantId, body, auth.actor, requestId) };
  });
  router.patch('/api/v1/work-items/:id', async ({ auth, params, body, requestId }) => {
    requireScope(auth, 'write');
    return updateWorkItem(db, auth.tenantId, params.id, body, auth.actor, requestId);
  });
  router.get('/api/v1/companies/:id/evidence-reviews', async ({ auth, params, query }) => listEvidenceReviews(db, auth.tenantId, params.id, query));
  router.post('/api/v1/companies/:id/evidence-reviews', async ({ auth, params, body, requestId }) => {
    requireScope(auth, 'write');
    return reviewEvidence(db, auth.tenantId, params.id, body, auth.actor, requestId);
  });
}
