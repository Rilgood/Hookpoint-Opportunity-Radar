import { normalizeDomain, normalizeName, sha256, stableJson } from '../lib.js';

const companyFrom = (item, fallback = {}) => ({
  name: fallback.name || fallback.company_name || item.companyName || item.name || item.title,
  domain: normalizeDomain(fallback.domain || fallback.website_url || item.companyWebsite || item.website || item.domain),
  website_url: fallback.website_url || item.companyWebsite || item.website,
  industry: item.categoryName || item.industry || fallback.industry,
  city: item.city || item.address?.city || fallback.city,
  state: item.state || item.address?.state || fallback.state,
  country: item.countryCode || item.country || fallback.country
});

export function normalizeApify(key, item, input = {}) {
  const fallback = input.company || {};
  const lineage = timeLineage(item.date || item.publishedAt || item.createdAt, `${key}-v1`);
  if (key === 'apify_google_maps') {
    const snapshot = input.snapshot_id || lineage.retrieved_at.slice(0, 10);
    const entityId = item.placeId || item.cid || item.url || item.title || fallback.name;
    return {
      source: 'google_maps', external_id: entityId ? `maps-snapshot:${sha256(`${entityId}:${snapshot}`).slice(0, 32)}` : null, type: 'review_metric',
      title: `${item.title || fallback.name} has ${item.totalScore || 'an unknown'} rating from ${item.reviewsCount || 0} reviews`,
      url: item.url, ...lineage, confidence: 0.88, company: companyFrom(item, fallback),
      raw_ref: item.placeId ? `google_maps:${item.placeId}` : null,
      attributes: { rating: item.totalScore, reviews_total: item.reviewsCount, category: item.categoryName, address: item.address, reviews_7d: item.reviewsCountRecent }
    };
  }
  if (key === 'apify_facebook_ads') {
    const company = { ...fallback, name: item.pageName || fallback.name, domain: fallback.domain };
    return {
      source: 'meta_ad_library', external_id: String(item.adArchiveID || item.id || item.url || ''), type: 'ad_snapshot',
      title: `${company.name} has an active Meta creative`, body: item.adCreativeBodies?.join(' ') || item.bodyText,
      url: item.adSnapshotURL || item.url, ...lineage, confidence: 0.9, company,
      attributes: { active_ads: input.active_ads || 1, previous_active_ads: input.previous_active_ads, creative_started_at: item.startDate, platforms: item.publisherPlatform, creative_url: item.imageUrl || item.videoUrl }
    };
  }
  if (key === 'apify_linkedin_jobs') {
    return {
      source: 'linkedin_jobs', external_id: String(item.id || item.jobId || item.url || ''), type: 'job_posting',
      title: item.title || item.jobTitle || 'New job posting', body: item.descriptionText || item.description,
      url: item.url || item.jobUrl, ...lineage, confidence: 0.85,
      company: { ...fallback, name: item.companyName || fallback.name, domain: normalizeDomain(item.companyWebsite || fallback.domain) },
      attributes: { role: item.title || item.jobTitle, location: item.location, marketing_openings_30d: input.marketing_openings_30d }
    };
  }
  if (key === 'apify_instagram' || key === 'apify_tiktok') {
    const platform = key.replace('apify_', '');
    return {
      source: platform, external_id: String(item.id || item.shortCode || item.url || ''), type: 'social_metric',
      title: `${fallback.name || item.ownerFullName || item.authorMeta?.name} social content snapshot`, body: item.caption || item.text,
      url: item.url || item.webVideoUrl, ...lineage, confidence: 0.76,
      company: { ...fallback, name: fallback.name || item.ownerFullName || item.authorMeta?.name },
      attributes: { views: item.videoViewCount || item.playCount, likes: item.likesCount || item.diggCount, comments: item.commentsCount, shares: item.shareCount, performance_vs_baseline: input.performance_vs_baseline, engagement_delta_pct: input.engagement_delta_pct }
    };
  }
  if (key === 'apify_website') {
    const version = item.checksum || input.snapshot_id || lineage.retrieved_at.slice(0, 10);
    const entityId = item.url || fallback.domain;
    return {
      source: 'company_website', external_id: entityId ? `website-snapshot:${sha256(`${entityId}:${version}`).slice(0, 32)}` : null, type: 'website_change',
      title: input.title || `${fallback.name || item.metadata?.title || 'Company'} website snapshot`, body: item.text || item.markdown,
      url: item.url, ...lineage, confidence: 0.8, company: companyFrom({ ...item, website: item.website || item.url }, fallback),
      attributes: { change_type: input.change_type || 'content_snapshot', checksum: item.checksum }
    };
  }
  if (key === 'apify_google_reviews') {
    return {
      source: 'google_reviews', external_id: String(item.reviewId || item.id || item.url || ''), type: 'review_metric',
      title: `${fallback.name || item.title || 'Company'} review activity`, body: item.text,
      url: item.reviewUrl || item.url, ...lineage, confidence: 0.82, company: companyFrom(item, fallback),
      attributes: { rating: item.stars || item.rating, reviews_7d: input.reviews_7d, review_velocity_delta_pct: input.review_velocity_delta_pct, sentiment: input.sentiment }
    };
  }
  if (key === 'apify_google_search') {
    return {
      source: 'google_search', external_id: String(item.url || item.position || ''), type: input.type || 'news',
      title: item.title || input.title || 'Search result', body: item.description || item.snippet,
      url: item.url, ...lineage, confidence: 0.68, company: { ...fallback }, attributes: input.attributes || {}
    };
  }
  if (key === 'apify_linkedin_company') {
    const entityId = item.companyId || item.id || item.url || item.name;
    const version = sha256(stableJson({ employee_count: item.employeeCount ?? null, follower_count: item.followerCount ?? null, description: item.description || null })).slice(0, 16);
    return {
      source: 'linkedin_company', external_id: entityId ? `${entityId}:${version}` : null, type: input.type || 'news',
      title: item.name ? `${item.name} company profile updated` : 'LinkedIn company update', body: item.description,
      url: item.url || item.linkedinUrl, ...lineage, confidence: 0.82,
      company: companyFrom({ ...item, website: item.website || item.companyWebsite, url: undefined }, fallback),
      attributes: { employee_count: item.employeeCount, follower_count: item.followerCount, ...input.attributes }
    };
  }
  return null;
}

export function normalizeApifyCollection(key, items, input = {}) {
  if (key !== 'apify_facebook_ads' || !items.length) return null;
  const fallback = input.company || {};
  const unique = [...new Map(items.map((item, index) => [String(item.adArchiveID || item.id || item.url || index), item])).values()];
  const first = unique[0] || {};
  const retrieved = new Date().toISOString();
  const ages = unique.map((item) => ageDays(item.startDate || item.createdAt, retrieved)).filter(Number.isFinite).sort((a, b) => a - b);
  const fingerprints = unique.map((item) => normalizeName(item.adCreativeBodies?.join(' ') || item.bodyText || item.imageUrl || item.videoUrl || '')).filter(Boolean);
  const distinctCreative = new Set(fingerprints).size;
  const pageIdentity = first.pageID || first.pageId || fallback.domain || first.pageName || fallback.name || 'unknown-page';
  const snapshot = input.snapshot_id || retrieved.slice(0, 10);
  const company = { ...fallback, name: first.pageName || fallback.name, domain: fallback.domain };
  return {
    source: 'meta_ad_library', external_id: `account-snapshot:${pageIdentity}:${snapshot}`, type: 'ad_snapshot',
    title: `${company.name || 'Company'} has ${unique.length} active Meta creative${unique.length === 1 ? '' : 's'}`,
    body: unique.flatMap((item) => item.adCreativeBodies || [item.bodyText]).filter(Boolean).slice(0, 5).join(' | ') || null,
    url: first.adSnapshotURL || first.url, observed_at: retrieved, retrieved_at: retrieved,
    event_time_quality: 'retrieval_time', normalizer_version: 'apify_facebook_ads-v2', confidence: 0.9, company,
    attributes: {
      metric_scope: 'account_snapshot', active_ads: unique.length,
      new_ads_7d: unique.filter((item) => ageDays(item.startDate || item.createdAt, retrieved) <= 7).length,
      median_creative_age_days: ages.length ? roundMetric(ages[Math.floor(ages.length / 2)]) : null,
      duplicate_creative_ratio: fingerprints.length ? roundMetric(1 - distinctCreative / fingerprints.length) : null,
      platforms: [...new Set(unique.flatMap((item) => item.publisherPlatform || []))]
    }
  };
}

function timeLineage(value, normalizerVersion) {
  const retrieved = new Date().toISOString();
  const observed = normalizeTimestamp(value);
  return {
    observed_at: observed || retrieved,
    retrieved_at: retrieved,
    event_time_quality: observed ? 'provider_estimated' : 'retrieval_time',
    normalizer_version: normalizerVersion
  };
}

function normalizeTimestamp(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  const date = typeof value === 'number' || /^\d{10,13}$/.test(String(value))
    ? new Date(numeric < 1e12 ? numeric * 1_000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ageDays(value, now) {
  const timestamp = normalizeTimestamp(value);
  return timestamp ? Math.max(0, (new Date(now).getTime() - new Date(timestamp).getTime()) / 86_400_000) : NaN;
}

function roundMetric(value) { return Math.round(Number(value) * 1_000) / 1_000; }
