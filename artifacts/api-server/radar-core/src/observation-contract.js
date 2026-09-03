export const observationTypes = Object.freeze([
  'funding','leadership_change','product_launch','expansion','location_event','partnership','contract_award','grant_award',
  'job_posting','hiring_metric','rfp','social_post','news','ad_snapshot','creative_metric','social_metric','search_trend',
  'traffic_metric','conversion_metric','campaign_metric','website_change','technology_change','review_metric','competitor_event',
  'event','seasonal_event','crm_activity','web_intent','permit','acquisition','merger','earnings','crisis','recall','legal_event','layoff'
]);

export const observationTypeSet = new Set(observationTypes);
