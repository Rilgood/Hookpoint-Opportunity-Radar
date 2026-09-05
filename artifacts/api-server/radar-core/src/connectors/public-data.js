import { BaseConnector } from './base.js';
import { AppError } from '../lib.js';
import { requestJson } from './http-client.js';

const SEC_SUBMISSIONS_ENDPOINT = 'https://data.sec.gov/submissions/';
const NPPES_ENDPOINT = 'https://npiregistry.cms.hhs.gov/api/';
const USA_SPENDING_ENDPOINT = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const SEC_USER_AGENT = 'Hookpoint Opportunity Radar public-data connector (radar@hookpoint.com)';
const CONTRACT_CODES = new Set(['A', 'B', 'C', 'D']);
const GRANT_CODES = new Set(['02', '03', '04', '05']);
const AWARD_LABEL_TYPES = new Map([
  ['definitive contract', 'contract_award'],
  ['purchase order', 'contract_award'],
  ['delivery order', 'contract_award'],
  ['bpa call', 'contract_award'],
  ['blanket purchase agreement call', 'contract_award'],
  ['block grant', 'grant_award'],
  ['formula grant', 'grant_award'],
  ['project grant', 'grant_award'],
  ['cooperative agreement', 'grant_award']
]);

export class SecEdgarConnector extends BaseConnector {
  validateInput(input = {}) {
    return {
      cik: normalizeCik(input.cik ?? input.company?.cik),
      limit: boundedInteger(input.limit, 50, 1, 100, 'limit'),
      forms: normalizeForms(input.forms),
      dates: boundedDateRange(input.from ?? input.start_date, input.to ?? input.end_date, 3 * 366, 366)
    };
  }
  async collect(input = {}) {
    const { cik, limit, forms, dates } = this.validateInput(input);
    const cursor = normalizeSecCursor(input.cursor);
    const url = new URL(`CIK${cik}.json`, SEC_SUBMISSIONS_ENDPOINT);
    const payload = await requestJson(url, { headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json' }, retries: 2 });
    const recent = payload?.filings?.recent;
    if (!recent || typeof recent !== 'object') throw new AppError(502, 'invalid_provider_payload', 'SEC EDGAR submissions payload did not include recent filings.');
    const length = Array.isArray(recent.accessionNumber) ? recent.accessionNumber.length : 0;
    const items = [];
    for (let index = 0; index < length; index += 1) {
      const accessionNumber = String(recent.accessionNumber[index] || '');
      const filingDate = String(recent.filingDate?.[index] || '');
      const form = String(recent.form?.[index] || '').toUpperCase();
      if (!accessionNumber || !validIsoDateOnly(filingDate) || (forms && !forms.has(form))) continue;
      if (filingDate < dates.start || filingDate > dates.end) continue;
      items.push({
        cik, issuerName: payload.name, sic: payload.sic, sicDescription: payload.sicDescription,
        accessionNumber, filingDate, reportDate: recent.reportDate?.[index], acceptanceDateTime: recent.acceptanceDateTime?.[index],
        form, primaryDocument: recent.primaryDocument?.[index], primaryDocDescription: recent.primaryDocDescription?.[index],
        fileNumber: recent.fileNumber?.[index], filmNumber: recent.filmNumber?.[index]
      });
    }
    const page = paginateSecFilings(items, cursor, limit);
    return {
      items: page.items,
      cursor: page.cursor,
      usage: { requests: 1, provider_recent_filings: length, matched_filings: items.length }
    };
  }

  normalize(filing, input = {}) {
    const retrieved = new Date().toISOString();
    const archiveUrl = secArchiveUrl(filing);
    return {
      source: 'sec_edgar',
      external_id: filing.accessionNumber,
      type: 'sec_filing',
      title: `${filing.issuerName || input.company?.name || 'SEC registrant'} filed Form ${filing.form}`,
      body: filing.primaryDocDescription || null,
      url: archiveUrl,
      raw_ref: `sec-edgar:${filing.accessionNumber}`,
      observed_at: `${filing.filingDate}T00:00:00.000Z`,
      retrieved_at: retrieved,
      event_time_quality: 'reported',
      normalizer_version: 'sec-edgar-v1',
      confidence: 0.99,
      company: { ...input.company, name: filing.issuerName || input.company?.name, cik: filing.cik },
      attributes: {
        cik: filing.cik, form: filing.form, accession_number: filing.accessionNumber,
        filing_date: filing.filingDate, report_date: filing.reportDate || null,
        accepted_at: normalizeTimestamp(filing.acceptanceDateTime), file_number: filing.fileNumber || null,
        film_number: filing.filmNumber || null, sic: filing.sic || null,
        sic_description: filing.sicDescription || null, primary_document: filing.primaryDocument || null
      }
    };
  }
}

export class NppesConnector extends BaseConnector {
  validateInput(input = {}) {
    const organizationName = String(input.organization_name ?? input.company?.name ?? '').trim();
    const npi = input.npi == null || input.npi === '' ? null : normalizeNpi(input.npi);
    if (!organizationName && !npi) throw new AppError(400, 'company_required', 'NPPES requires an organization name or NPI.');
    if (organizationName.length > 200) throw new AppError(400, 'invalid_organization_name', 'organization_name may not exceed 200 characters.');
    return {
      organizationName, npi,
      limit: boundedInteger(input.limit, 50, 1, 200, 'limit'),
      skip: boundedInteger(input.skip, 0, 0, 1_000, 'skip'),
      state: normalizeState(input.state)
    };
  }
  async collect(input = {}) {
    const { organizationName, npi, limit, state } = this.validateInput(input);
    requirePageCursor(input.cursor, 'skip');
    const cursorSkip = input.cursor == null ? undefined : input.cursor.skip;
    const skip = boundedInteger(cursorSkip ?? input.skip, 0, 0, 1_000, 'skip');
    const url = new URL(NPPES_ENDPOINT);
    url.searchParams.set('version', '2.1');
    url.searchParams.set('enumeration_type', 'NPI-2');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('skip', String(skip));
    if (npi) url.searchParams.set('number', npi);
    if (organizationName) url.searchParams.set('organization_name', organizationName);
    if (state) url.searchParams.set('state', state);
    const payload = await requestJson(url, { retries: 2 });
    const providerItems = Array.isArray(payload.results) ? payload.results : [];
    const items = providerItems.filter((item) => item.enumeration_type === 'NPI-2');
    const nextSkip = skip + providerItems.length;
    return {
      items,
      cursor: providerItems.length === limit && nextSkip <= 1_000 ? { skip: nextSkip } : null,
      usage: { requests: 1, provider_result_count: Number(payload.result_count ?? providerItems.length), returned: items.length }
    };
  }

  normalize(provider, input = {}) {
    if (provider.enumeration_type !== 'NPI-2') throw new AppError(422, 'unsupported_npi_entity', 'NPPES result is not an NPI-2 organization.');
    const npi = normalizeNpi(provider.number);
    const basic = provider.basic || {};
    const name = String(basic.organization_name || input.company?.name || '').trim();
    if (!name) throw new AppError(422, 'invalid_provider_payload', 'NPPES organization result is missing organization_name.');
    const retrieved = new Date().toISOString();
    const updated = normalizeEpoch(provider.last_updated_epoch);
    const primaryAddress = (provider.addresses || []).find((address) => address.address_purpose === 'LOCATION') || provider.addresses?.[0] || {};
    return {
      source: 'nppes',
      external_id: npi,
      type: 'provider_profile',
      title: `${name} NPPES organization profile`,
      body: basic.authorized_official_last_name ? `Authorized official: ${[basic.authorized_official_first_name, basic.authorized_official_last_name].filter(Boolean).join(' ')}` : null,
      url: `https://npiregistry.cms.hhs.gov/provider-view/${npi}`,
      raw_ref: `nppes:${npi}`,
      observed_at: updated || retrieved,
      retrieved_at: retrieved,
      event_time_quality: updated ? 'provider_estimated' : 'retrieval_time',
      normalizer_version: 'nppes-v1',
      confidence: 0.99,
      company: {
        ...input.company, name, city: primaryAddress.city || input.company?.city,
        state: primaryAddress.state || input.company?.state, country: primaryAddress.country_code || input.company?.country
      },
      attributes: {
        npi, enumeration_type: 'NPI-2', status: basic.status || null,
        credential: basic.credential || null, organization_name: name,
        organization_name_other: basic.organization_name_other || null,
        last_updated_epoch: provider.last_updated_epoch ?? null,
        taxonomies: (provider.taxonomies || []).map(({ code, desc, primary, state, license }) => ({ code, description: desc, primary: Boolean(primary), state: state || null, license: license || null })),
        addresses: (provider.addresses || []).map(({ address_purpose, address_1, address_2, city, state, postal_code, country_code, telephone_number }) => ({
          purpose: address_purpose, address_1, address_2: address_2 || null, city, state, postal_code, country_code, telephone_number: telephone_number || null
        }))
      }
    };
  }
}

export class UsaSpendingConnector extends BaseConnector {
  validateInput(input = {}) {
    const companyName = String(input.company?.name || '').trim();
    if (!companyName) throw new AppError(400, 'company_required', 'USAspending requires a target company name.');
    if (companyName.length > 200) throw new AppError(400, 'invalid_company_name', 'Target company name may not exceed 200 characters.');
    return {
      companyName,
      limit: boundedInteger(input.limit, 50, 1, 100, 'limit'),
      initialPage: boundedInteger(input.page, 1, 1, 1_000, 'page'),
      dates: boundedDateRange(input.start_date ?? input.from, input.end_date ?? input.to, 3 * 366, 366),
      awardCodes: normalizeAwardCodes(input.award_type_codes)
    };
  }
  async collect(input = {}) {
    const { companyName, limit, initialPage, dates, awardCodes } = this.validateInput(input);
    const cursor = normalizeUsaSpendingCursor(input.cursor);
    const groups = [
      { key: 'contract', cursorKey: 'contract_page', codes: awardCodes.filter((code) => CONTRACT_CODES.has(code)) },
      { key: 'grant', cursorKey: 'grant_page', codes: awardCodes.filter((code) => GRANT_CODES.has(code)) }
    ].filter((group) => group.codes.length && (!cursor || cursor[group.cursorKey] != null));
    const responses = await Promise.all(groups.map(async (group) => {
      const page = boundedInteger(cursor?.[group.cursorKey] ?? initialPage, 1, 1, 1_000, `${group.key}_page`);
      const body = {
        filters: {
          time_period: [{ start_date: dates.start, end_date: dates.end }],
          recipient_search_text: [companyName],
          award_type_codes: group.codes
        },
        fields: ['Award ID', 'Recipient Name', 'Start Date', 'End Date', 'Award Amount', 'Awarding Agency', 'Awarding Sub Agency', 'Award Type'],
        page,
        limit,
        subawards: false
      };
      const payload = await requestJson(new URL(USA_SPENDING_ENDPOINT), {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body), retries: 1
      });
      const results = Array.isArray(payload.results) ? payload.results : [];
      const hasNext = Boolean(payload.page_metadata?.hasNext ?? payload.page_metadata?.has_next_page ?? (results.length === limit));
      return { ...group, page, results, hasNext, total: Number(payload.page_metadata?.total ?? results.length) };
    }));
    const merged = responses.flatMap((response) => response.results.map((award, index) => ({
      ...award, _radar_award_group: response.key, _radar_result_order: index
    })));
    const items = deduplicateAwards(merged);
    const nextCursor = {};
    for (const response of responses) {
      if (response.hasNext && response.page < 1_000) nextCursor[response.cursorKey] = response.page + 1;
    }
    return {
      items,
      cursor: Object.keys(nextCursor).length ? nextCursor : null,
      usage: {
        requests: responses.length,
        returned: items.length,
        provider_total: responses.reduce((sum, response) => sum + response.total, 0),
        pages: Object.fromEntries(responses.map((response) => [response.key, response.page]))
      }
    };
  }

  normalize(award, input = {}) {
    const awardCode = String(award['Award Type Code'] ?? award.award_type_code ?? '').trim().toUpperCase();
    const awardLabel = String(award['Award Type'] ?? award.award_type ?? '').trim();
    const displayedType = awardCode
      ? CONTRACT_CODES.has(awardCode) ? 'contract_award' : GRANT_CODES.has(awardCode) ? 'grant_award' : null
      : AWARD_LABEL_TYPES.get(awardLabel.toLowerCase());
    const type = award._radar_award_group === 'contract' ? 'contract_award'
      : award._radar_award_group === 'grant' ? 'grant_award' : null;
    if (!type) throw new AppError(422, 'unsupported_award_type', 'USAspending award is missing a valid connector request-group annotation.');
    if (awardCode && !displayedType) throw new AppError(422, 'unsupported_award_type', `USAspending returned an unsupported award type code: ${awardCode}`);
    if (displayedType && displayedType !== type) throw new AppError(422, 'award_type_group_mismatch', 'USAspending award type did not match the requested award group.');
    const amount = Number(award['Award Amount'] ?? award.award_amount);
    if (!Number.isFinite(amount)) throw new AppError(422, 'invalid_award_amount', 'USAspending award amount must be numeric.');
    const awardId = String(award['Award ID'] ?? award.award_id ?? '').trim();
    const internalId = String(award.generated_internal_id ?? award.generated_unique_award_id ?? '').trim();
    if (!awardId && !internalId) throw new AppError(422, 'invalid_provider_payload', 'USAspending award is missing an identifier.');
    const recipient = String(award['Recipient Name'] ?? award.recipient_name ?? input.company?.name ?? '').trim();
    const startDate = normalizeDateOnly(award['Start Date'] ?? award.start_date);
    const retrieved = new Date().toISOString();
    const evidenceId = internalId || awardId;
    return {
      source: 'usa_spending',
      external_id: evidenceId,
      type,
      title: awardLabel
        ? `${recipient || input.company.name} received a federal ${type === 'contract_award' ? 'contract' : 'grant'} award`
        : `${recipient || input.company.name} — Federal ${type === 'contract_award' ? 'contract' : 'grant'} award`,
      body: null,
      url: `https://www.usaspending.gov/award/${encodeURIComponent(evidenceId)}/`,
      raw_ref: `usa-spending:${evidenceId}`,
      observed_at: startDate ? `${startDate}T00:00:00.000Z` : retrieved,
      retrieved_at: retrieved,
      event_time_quality: startDate ? 'reported' : 'retrieval_time',
      normalizer_version: 'usa-spending-v1',
      confidence: 0.98,
      company: { ...input.company, name: recipient || input.company.name },
      attributes: {
        amount, award_id: awardId || null, generated_internal_id: internalId || null,
        award_type_code: awardCode || null, award_type: awardLabel || null,
        award_group: award._radar_award_group || null,
        start_date: startDate, end_date: normalizeDateOnly(award['End Date'] ?? award.end_date),
        awarding_agency: award['Awarding Agency'] ?? award.awarding_agency ?? null,
        awarding_sub_agency: award['Awarding Sub Agency'] ?? award.awarding_sub_agency ?? null
      }
    };
  }
}

function boundedInteger(value, fallback, minimum, maximum, field) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new AppError(400, `invalid_connector_${field}`, `${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function requirePageCursor(cursor, field) {
  if (cursor != null && (typeof cursor !== 'object' || Array.isArray(cursor) || !Object.hasOwn(cursor, field))) {
    throw new AppError(400, 'invalid_connector_cursor', `Connector cursor must contain ${field}.`);
  }
}

function normalizeUsaSpendingCursor(cursor) {
  if (cursor == null) return null;
  if (typeof cursor !== 'object' || Array.isArray(cursor)) {
    throw new AppError(400, 'invalid_connector_cursor', 'USAspending cursor must be an object.');
  }
  const allowed = new Set(['contract_page', 'grant_page']);
  const keys = Object.keys(cursor);
  if (!keys.length || keys.some((key) => !allowed.has(key)) || !keys.some((key) => cursor[key] != null)) {
    throw new AppError(400, 'invalid_connector_cursor', 'USAspending cursor must contain contract_page or grant_page.');
  }
  const normalized = {};
  for (const key of keys) {
    if (cursor[key] != null) normalized[key] = boundedInteger(cursor[key], 1, 1, 1_000, key);
  }
  return normalized;
}

function deduplicateAwards(items) {
  const seen = new Set();
  return items.filter((award) => {
    const stableId = String(award.generated_internal_id ?? award.generated_unique_award_id ?? award['Award ID'] ?? award.award_id ?? '').trim();
    if (!stableId) return true;
    if (seen.has(stableId)) return false;
    seen.add(stableId);
    return true;
  });
}

function normalizeCik(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,10}$/.test(text) || Number(text) < 1) throw new AppError(400, 'invalid_cik', 'SEC EDGAR requires a CIK containing 1 to 10 digits.');
  return text.padStart(10, '0');
}

function normalizeForms(value) {
  if (value == null || value === '') return null;
  const forms = Array.isArray(value) ? value : String(value).split(',');
  if (!forms.length || forms.length > 20) throw new AppError(400, 'invalid_sec_forms', 'forms must contain between 1 and 20 SEC form names.');
  const normalized = forms.map((form) => String(form).trim().toUpperCase());
  if (normalized.some((form) => !/^[A-Z0-9][A-Z0-9 /-]{0,19}$/.test(form))) throw new AppError(400, 'invalid_sec_forms', 'forms contains an invalid SEC form name.');
  return new Set(normalized);
}

function boundedDateRange(startValue, endValue, maximumDays, defaultDays) {
  const today = new Date().toISOString().slice(0, 10);
  const end = endValue == null || endValue === '' ? today : normalizeDateOnlyRequired(endValue, 'end_date');
  const defaultStart = new Date(`${end}T00:00:00.000Z`);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - defaultDays);
  const start = startValue == null || startValue === '' ? defaultStart.toISOString().slice(0, 10) : normalizeDateOnlyRequired(startValue, 'start_date');
  const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  if (span < 0 || span > maximumDays) throw new AppError(400, 'invalid_connector_date_range', `Date range must be ordered and no more than ${maximumDays} days.`);
  if (end > today) throw new AppError(400, 'invalid_connector_date_range', 'end_date may not be in the future.');
  return { start, end };
}

function normalizeDateOnlyRequired(value, field) {
  const text = String(value);
  if (!validIsoDateOnly(text)) throw new AppError(400, `invalid_connector_${field}`, `${field} must be a valid YYYY-MM-DD date.`);
  return text;
}

function normalizeDateOnly(value) {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 10);
  return validIsoDateOnly(text) ? text : null;
}

function validIsoDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function normalizeSecCursor(cursor) {
  if (cursor == null) return null;
  if (typeof cursor !== 'object' || Array.isArray(cursor)) {
    throw new AppError(400, 'invalid_connector_cursor', 'SEC cursor must be an object.');
  }
  // Migrate the original completed-watermark cursor without dropping in-flight schedules.
  if (Object.hasOwn(cursor, 'filed_at') || Object.hasOwn(cursor, 'accession_number')) {
    return { high_water: normalizeSecPosition(cursor, 'cursor') };
  }
  const allowed = new Set(['high_water', 'pending_high_water', 'page_after']);
  if (!Object.keys(cursor).length || Object.keys(cursor).some((key) => !allowed.has(key))) {
    throw new AppError(400, 'invalid_connector_cursor', 'SEC cursor contains unsupported fields.');
  }
  const normalized = {
    high_water: cursor.high_water == null ? null : normalizeSecPosition(cursor.high_water, 'high_water')
  };
  const draining = cursor.page_after != null || cursor.pending_high_water != null;
  if (draining && (cursor.page_after == null || cursor.pending_high_water == null)) {
    throw new AppError(400, 'invalid_connector_cursor', 'SEC backlog cursor must contain page_after and pending_high_water.');
  }
  if (draining) {
    normalized.page_after = normalizeSecPosition(cursor.page_after, 'page_after');
    normalized.pending_high_water = normalizeSecPosition(cursor.pending_high_water, 'pending_high_water');
  }
  return normalized;
}

function normalizeSecPosition(position, field) {
  if (typeof position !== 'object' || Array.isArray(position)
    || !validIsoDateOnly(String(position.filed_at || ''))
    || !/^\d{10}-\d{2}-\d{6}$/.test(String(position.accession_number || ''))) {
    throw new AppError(400, 'invalid_connector_cursor', `SEC ${field} must contain filed_at and accession_number.`);
  }
  return { filed_at: position.filed_at, accession_number: position.accession_number };
}

function paginateSecFilings(items, cursor, limit) {
  const highWater = cursor?.high_water || null;
  if (cursor?.page_after) {
    const anchorIndex = items.findIndex((item) => sameSecPosition(item, cursor.page_after));
    if (anchorIndex < 0) {
      throw new AppError(409, 'connector_cursor_unavailable', 'SEC backlog cursor is no longer present in the recent submissions payload; refusing to skip unprocessed filings.');
    }
    const highWaterIndex = highWater ? items.findIndex((item) => sameSecPosition(item, highWater)) : items.length;
    if (highWater && (highWaterIndex < 0 || highWaterIndex <= anchorIndex)) {
      throw new AppError(409, 'connector_cursor_unavailable', 'SEC completed high-water cursor is no longer in the expected provider order; refusing to skip unprocessed filings.');
    }
    const backlog = items.slice(anchorIndex + 1, highWaterIndex);
    const selected = backlog.slice(0, limit);
    if (backlog.length > limit) {
      return {
        items: selected,
        cursor: {
          high_water: highWater,
          pending_high_water: cursor.pending_high_water,
          page_after: secPosition(selected[selected.length - 1])
        }
      };
    }
    return { items: selected, cursor: { high_water: cursor.pending_high_water } };
  }

  const highWaterIndex = highWater ? items.findIndex((item) => sameSecPosition(item, highWater)) : items.length;
  if (highWater && highWaterIndex < 0) {
    throw new AppError(409, 'connector_cursor_unavailable', 'SEC completed high-water cursor is no longer present in the recent submissions payload; refusing to skip filings.');
  }
  const unprocessed = items.slice(0, highWaterIndex);
  if (!unprocessed.length) return { items: [], cursor: cursor || null };
  const selected = unprocessed.slice(0, limit);
  const pendingHighWater = secPosition(unprocessed[0]);
  if (unprocessed.length > limit) {
    return {
      items: selected,
      cursor: {
        high_water: highWater,
        pending_high_water: pendingHighWater,
        page_after: secPosition(selected[selected.length - 1])
      }
    };
  }
  return { items: selected, cursor: { high_water: pendingHighWater } };
}

function secPosition(filing) {
  return { filed_at: filing.filingDate, accession_number: filing.accessionNumber };
}

function sameSecPosition(filing, position) {
  return filing.filingDate === position.filed_at && filing.accessionNumber === position.accession_number;
}

function secArchiveUrl(filing) {
  const accession = String(filing.accessionNumber).replace(/-/g, '');
  const cik = String(Number(filing.cik));
  const document = String(filing.primaryDocument || '').trim();
  const leaf = document && !document.includes('/') && !document.includes('\\')
    ? encodeURIComponent(document)
    : `${accession}-index.html`;
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/${leaf}`;
}

function normalizeState(value) {
  if (value == null || value === '') return null;
  const state = String(value).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new AppError(400, 'invalid_state', 'state must be a two-letter US state code.');
  return state;
}

function normalizeNpi(value) {
  const npi = String(value ?? '').trim();
  if (!/^\d{10}$/.test(npi)) throw new AppError(400, 'invalid_npi', 'NPI must contain exactly 10 digits.');
  return npi;
}

function normalizeEpoch(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const date = new Date(numeric < 1e12 ? numeric * 1_000 : numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeTimestamp(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeAwardCodes(value) {
  if (value == null || value === '') return [...CONTRACT_CODES, ...GRANT_CODES];
  const values = Array.isArray(value) ? value : String(value).split(',');
  if (!values.length || values.length > CONTRACT_CODES.size + GRANT_CODES.size) throw new AppError(400, 'invalid_award_type_codes', 'award_type_codes is invalid.');
  const codes = [...new Set(values.map((code) => String(code).trim().toUpperCase()))];
  if (codes.some((code) => !CONTRACT_CODES.has(code) && !GRANT_CODES.has(code))) {
    throw new AppError(400, 'invalid_award_type_codes', 'award_type_codes may contain only supported contract and grant codes.');
  }
  return codes;
}