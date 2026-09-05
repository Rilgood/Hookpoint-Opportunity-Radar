import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const workspaceRoot = resolve(dirname(new URL(import.meta.url).pathname), '../../../..');
const webAppRoot = resolve(workspaceRoot, 'artifacts/hookpoint-radar');
const outputFile = resolve(webAppRoot, '.merged-recommendation-context.test.cjs');

test('opportunity detail renders active and retained merged-account recommendation contexts separately', async (t) => {
  t.after(async () => rm(outputFile, { force: true }));

  await build({
    entryPoints: [resolve(webAppRoot, 'src/pages/opportunity-detail.tsx')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    outfile: outputFile,
    tsconfig: resolve(webAppRoot, 'tsconfig.json'),
    external: ['react', 'react-dom', 'react-dom/*'],
  });

  const React = require(resolve(webAppRoot, 'node_modules/react'));
  const { renderToStaticMarkup } = require(resolve(webAppRoot, 'node_modules/react-dom/server'));
  const { RecommendationPanels } = createRequire(pathToFileURL(outputFile))(outputFile);
  const mergedAt = '2026-08-28T00:00:00.000Z';
  // Merge timestamps represent instants. The console intentionally displays
  // their calendar date in the viewer's timezone, which can be the prior day.
  const expectedMergeDate = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  }).format(new Date(mergedAt));
  const html = renderToStaticMarkup(React.createElement(RecommendationPanels, {
    recommendation: {
      offer: 'Active account offer',
      outreach_angle: 'Active account outreach angle',
      proof_points: [{
        label: 'Active proof point',
        contribution: 8,
        summary: 'Current evidence for the surviving account.',
        source_count: 1,
        last_seen_at: '2026-09-04T00:00:00.000Z',
      }],
    },
    mergedRecommendationContexts: [{
      source_company_id: 'source-account',
      source_name: 'Former Source Account',
      merged_at: mergedAt,
      offer: 'Former account offer',
      headline: 'Former account headline',
      rationale: 'Historical rationale that reviewers need to retain.',
      outreach_angle: 'Historical outreach angle',
      next_action: 'Use this only when comparing the prior account record.',
      proof_points: [{
        label: 'Retained proof point',
        summary: 'Historical proof that must remain visible.',
      }],
    }],
  }));

  assert.match(html, /Recommended Playbook/);
  assert.match(html, /Active account offer/);
  assert.match(html, /Retained merged-account context/);
  assert.match(html, /Former Source Account/);
  assert.ok(html.includes(`Merged ${expectedMergeDate}`), `merge date should be ${expectedMergeDate} in the viewer's timezone`);
  assert.match(html, /Historical rationale that reviewers need to retain/);
  assert.match(html, /Former next step · reference only/);
  assert.match(html, /Use this only when comparing the prior account record/);

  const retainedSection = html.slice(html.indexOf('Retained merged-account context'));
  assert.doesNotMatch(retainedSection, /<button\b|<a\b/);
});
