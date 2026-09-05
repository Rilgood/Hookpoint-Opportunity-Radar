// Fictional fixtures for the isolated local workspace. These are never imported
// by the production application or presented as observations of real companies.
export function demoObservations(now = Date.now(), webPort = 5173) {
  const company = (name, domain, industry, employeeCount, extra = {}) => ({
    name: `${name} (Demo)`, domain: domain ? `${domain}.example` : undefined,
    industry, employee_count: employeeCount, country: 'US', ...extra,
  });
  const northstar = company('Northstar Outdoor', 'northstar-outdoor', 'Retail', 120, { city: 'Portland', state: 'OR', owner_name: 'Alex · Demo' });
  const brightline = company('Brightline Home', 'brightline-home', 'Home Services', 210, { city: 'Austin', state: 'TX' });
  const harbor = company('Harbor Health', 'harbor-health', 'Healthcare', 78, { city: 'Boston', state: 'MA', owner_name: 'Jordan · Demo' });
  const cedar = company('Cedar Table', 'cedar-table', 'Food & Beverage', 44, { city: 'Denver', state: 'CO' });
  const riskline = company('Riskline Labs', 'riskline-labs', 'Technology', 440);
  const solstice = company('Solstice Travel', 'solstice-travel', 'Travel', 90);
  const atlas = company('Atlas Learning', 'atlas-learning', 'Education', 180, { owner_name: 'Alex · Demo' });
  const juniper = company('Juniper Goods', 'juniper-goods', 'Retail', 65, { owner_name: 'Jordan · Demo' });
  const rook = company('Rook Finance', 'rook-finance', 'Financial Services', 350);
  const alder = company('Alder Studio', null, 'Professional Services', 30, { country: undefined });
  const records = [];
  function add(account, source, type, title, attributes, daysAgo = 1, confidence = 0.92) {
    const externalId = `demo-${records.length + 1}`;
    records.push({
      source: `demo_${source}`, external_id: externalId, type,
      title: `[Fictional scenario] ${title}`,
      body: 'Synthetic scenario created to demonstrate the evidence and qualification workflow. No real company, buying activity or provider connection is represented.',
      url: `http://127.0.0.1:${webPort}/api/demo/evidence/${externalId}`,
      observed_at: new Date(now - daysAgo * 86_400_000).toISOString(),
      retrieved_at: new Date(now).toISOString(), event_time_quality: 'reported',
      normalizer_version: 'fictional-demo-v1', raw_ref: `fictional-demo:${externalId}`,
      confidence, company: account, attributes: { ...attributes, synthetic: true },
    });
  }
  add(northstar, 'paid_media', 'ad_snapshot', 'Active ads rose from 20 to 37; repeated creative reached 68%', { active_ads: 37, previous_active_ads: 20, active_ads_delta_pct: 85, duplicate_creative_ratio: 0.68, median_creative_age_days: 31 });
  add(northstar, 'creative_review', 'creative_metric', 'Seven of ten openings use the same product promise', { hook_diversity_score: 28, dominant_hook_share: 0.72 });
  add(northstar, 'social_analytics', 'social_metric', 'Engagement rate fell 34% against its previous period', { engagement_rate_delta_pct: -34 }, 2);
  add(northstar, 'company_news', 'product_launch', 'Northstar launches its autumn trail collection', { is_new: true }, 3);
  add(northstar, 'first_party', 'crm_activity', 'A referred growth lead requested a strategy session', { demo_requested: true, relationship: 'referral' }, 0.3, 0.98);
  add(brightline, 'partner_brief', 'rfp', 'Brightline opens a creative partner brief for regional growth', { explicit_agency_search: true }, 0.7, 0.96);
  add(brightline, 'job_board', 'job_posting', 'Five marketing roles open across performance creative', { role: 'Growth Marketing Lead', marketing_openings_30d: 5 }, 2);
  add(brightline, 'company_news', 'expansion', 'Brightline expands to three new service areas', { new_locations: 3 }, 4);
  add(brightline, 'campaign_analytics', 'campaign_metric', 'Acquisition cost increased 31% over the prior month', { cac_delta_pct: 31, roas_delta_pct: -24 }, 1);
  add(harbor, 'company_news', 'funding', 'Harbor announces a $12m Series A for national growth', { amount: 12_000_000 }, 5);
  add(harbor, 'leadership_news', 'leadership_change', 'Harbor appoints a new Chief Marketing Officer', { role: 'Chief Marketing Officer' }, 8);
  add(harbor, 'company_news', 'product_launch', 'Harbor launches an employer wellbeing platform', { is_new: true }, 2);
  add(harbor, 'creative_review', 'creative_metric', 'Launch creative concentrates 76% of ads on one hook', { dominant_hook_share: 0.76 }, 1);
  add(harbor, 'job_board', 'job_posting', 'Harbor recruits a performance marketing lead', { role: 'Performance Marketing Lead' }, 2);
  add(cedar, 'company_news', 'location_event', 'Cedar announces a new location opening', { new_locations: 1, event: 'opening' }, 4);
  add(cedar, 'review_analytics', 'review_metric', 'Cedar sees a 60% rise in review volume', { review_velocity_delta_pct: 60 }, 3, 0.82);
  add(riskline, 'risk_monitor', 'crisis', 'Riskline reports a material data breach under investigation', { severity: 'critical' }, 0.1, 0.99);
  add(riskline, 'risk_update', 'crisis', 'A second update confirms the unresolved data breach', { severity: 'critical' }, 0.05, 0.99);
  add(solstice, 'company_news', 'funding', 'Solstice raised expansion capital in a now-aging announcement', { amount: 4_500_000 }, 140, 0.85);
  add(atlas, 'first_party', 'crm_activity', 'Atlas requested a follow-up after a prior working session', { demo_requested: true, previous_meetings: 1 }, 1, 0.98);
  add(atlas, 'campaign_analytics', 'conversion_metric', 'Landing-page conversion fell 26% while traffic increased', { conversion_rate_delta_pct: -26, high_traffic_low_conversion: true }, 2);
  add(atlas, 'company_news', 'product_launch', 'Atlas launches its new professional learning catalog', { is_new: true }, 3);
  add(juniper, 'first_party', 'crm_activity', 'Juniper requested a creative strategy session', { demo_requested: true, relationship: 'referral' }, 6, 0.98);
  add(juniper, 'creative_review', 'creative_metric', 'Juniper has low opening-hook diversity', { hook_diversity_score: 22 }, 7);
  add(rook, 'job_board', 'job_posting', 'Rook is hiring a creative strategist', { role: 'Creative Strategist', marketing_openings_30d: 3 }, 10);
  add(alder, 'unverified_intake', 'rfp', 'Alder name-only intake mentions a creative partner brief', { explicit_agency_search: true }, 1, 0.7);
  add(alder, 'unverified_intake', 'creative_metric', 'Unverified intake reports concentrated creative', { hook_diversity_score: 20 }, 1, 0.7);
  return records;
}

export const demoOutcomes = [
  { domain: 'atlas-learning.example', outcome_type: 'meeting', note: 'Fictional scenario: discovery meeting booked after a human reviewed the evidence.' },
  { domain: 'juniper-goods.example', outcome_type: 'won', amount: 42_500, note: 'Fictional scenario: recorded project value, not actual revenue.' },
  { domain: 'rook-finance.example', outcome_type: 'lost', note: 'Fictional scenario: account retained its current agency.' },
];

export const demoAssignments = [
  { domain: 'northstar-outdoor.example', owner_name: 'Alex · Demo' },
  { domain: 'harbor-health.example', owner_name: 'Jordan · Demo' },
  { domain: 'atlas-learning.example', owner_name: 'Alex · Demo' },
  { domain: 'juniper-goods.example', owner_name: 'Jordan · Demo' },
];
