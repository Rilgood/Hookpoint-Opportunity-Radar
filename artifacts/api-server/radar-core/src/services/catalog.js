import fs from 'node:fs';
import { config } from '../config.js';
import { json } from '../lib.js';
import { observationTypeSet } from '../observation-contract.js';

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const operators = new Set(['eq','gte','lte','gt','lt','truthy','in','contains_any']);
const cadences = new Set(['realtime','hourly','daily','weekly','monthly','quarterly','manual']);

function validateSignals(items) {
  const keys = new Set();
  for (const item of items) {
    if (!/^[a-z0-9][a-z0-9_]{0,99}$/.test(item.key || '') || keys.has(item.key)) throw new Error(`Signal catalog contains an invalid or duplicate key: ${item.key}`);
    if (!item.label || !item.category || !item.offer || !item.play) throw new Error(`Signal ${item.key} is missing operator-facing metadata.`);
    if (!['need','intent','timing','risk'].includes(item.dimension)) throw new Error(`Signal ${item.key} has an invalid dimension.`);
    if (![1, -1].includes(item.polarity) || (item.dimension === 'risk') !== (item.polarity === -1)) throw new Error(`Signal ${item.key} has inconsistent polarity and dimension.`);
    if (!inRange(item.weight, 0.01, 100) || !inRange(item.halfLifeDays, 0.25, 730)) throw new Error(`Signal ${item.key} has invalid scoring parameters.`);
    if (!Array.isArray(item.match?.types) || !item.match.types.length || item.match.types.some((type) => typeof type !== 'string' || !type)) throw new Error(`Signal ${item.key} must declare observation types.`);
    if (item.match.types.some((type) => !observationTypeSet.has(type))) throw new Error(`Signal ${item.key} references an unsupported observation type.`);
    const conditions = [...(item.match.all || []), ...(item.match.any || [])];
    if (!conditions.length) throw new Error(`Signal ${item.key} must declare at least one match condition.`);
    for (const condition of conditions) {
      if (!condition || typeof condition.path !== 'string' || !operators.has(condition.op)) throw new Error(`Signal ${item.key} contains an invalid condition.`);
      if (['in','contains_any'].includes(condition.op) && (!Array.isArray(condition.value) || !condition.value.length)) throw new Error(`Signal ${item.key} requires an array value for ${condition.op}.`);
      if (['gte','lte','gt','lt'].includes(condition.op) && !Number.isFinite(Number(condition.value))) throw new Error(`Signal ${item.key} requires a numeric comparison value.`);
    }
    keys.add(item.key);
  }
  return items;
}

function validateConnectors(items) {
  const keys = new Set();
  for (const item of items) {
    if (!/^[a-z0-9][a-z0-9_]{0,99}$/.test(item.key || '') || keys.has(item.key)) throw new Error(`Connector catalog contains an invalid or duplicate key: ${item.key}`);
    if (!item.label || !item.category || !item.provider) throw new Error(`Connector ${item.key} is missing required metadata.`);
    if (!['pull','push','push_pull'].includes(item.mode)) throw new Error(`Connector ${item.key} has an invalid mode.`);
    if (!cadences.has(item.cadence)) throw new Error(`Connector ${item.key} has an invalid cadence.`);
    for (const envName of [item.keyEnv, item.actorEnv].filter(Boolean)) if (!/^[A-Z][A-Z0-9_]*$/.test(envName)) throw new Error(`Connector ${item.key} has an invalid environment variable name.`);
    keys.add(item.key);
  }
  return items;
}

export function validateScoring(item) {
  const requiredDimensions = ['fit','need','intent','timing'];
  if (!item.version || !requiredDimensions.every((key) => Object.hasOwn(item.dimensionWeights || {}, key))) throw new Error('Scoring configuration is missing a version or dimension weight.');
  const dimensions = requiredDimensions.map((key) => item.dimensionWeights[key]);
  const total = dimensions.reduce((sum, value) => sum + Number(value), 0);
  if (dimensions.some((value) => !inRange(value, 0, 1)) || Math.abs(total - 1) > 0.0001) throw new Error('Scoring dimension weights must contain four finite values that total 1.');
  if (!inRange(item.tierThresholds?.watch, 0, 100) || !inRange(item.tierThresholds?.warm, 0, 100) || !inRange(item.tierThresholds?.hot, 0, 100)
    || !(item.tierThresholds.hot > item.tierThresholds.warm && item.tierThresholds.warm > item.tierThresholds.watch)) throw new Error('Scoring tier thresholds are invalid.');
  const refreshKeys = ['hot','watchlist','qualified','universe'];
  if (!refreshKeys.every((key) => Object.hasOwn(item.refreshDays || {}, key))) throw new Error('Scoring refresh intervals are incomplete.');
  const finitePositive = [item.breadthBonusPerSignal, item.breadthBonusMaximum, item.activeDimensionThreshold,
    item.dimensionBreadthBonus, ...refreshKeys.map((key) => item.refreshDays[key])];
  if (finitePositive.some((value) => !inRange(value, 0, 10_000))) throw new Error('Scoring configuration contains an invalid numeric value.');
  if (!inRange(item.riskPenalty, 0, 2) || !inRange(item.riskSuppressionThreshold, 0, 100)
    || !inRange(item.corroboration?.maximum, 1, 2) || !inRange(item.evidenceConfidence?.maximum, 0.05, 1)
    || !inRange(item.corroboration?.sourceLift, 0, 1) || !inRange(item.corroboration?.evidenceLift, 0, 1)
    || !inRange(item.corroboration?.evidenceLiftLimit, 0, 100) || !inRange(item.evidenceConfidence?.additionalSourceLift, 0, 1)
    || !inRange(item.evidenceConfidence?.maximumRemainingLift, 0, 1)) throw new Error('Scoring confidence or corroboration settings are invalid.');
  const policy = item.calibrationPolicy || {};
  if (!inRange(policy.holdoutFraction ?? 0.25, 0.1, 0.5) || !Number.isInteger(policy.minimumSample ?? 30)
    || !Number.isInteger(policy.minEachClass ?? 10) || !Number.isInteger(policy.minimumTrainingSample ?? 30)
    || !Number.isInteger(policy.minTrainingEachClass ?? 10) || !inRange(policy.maxWeightShift ?? 0.05, 0.005, 0.1)
    || !inRange(policy.minimumAucLift ?? 0.01, 0, 0.2)) throw new Error('Scoring calibration policy is invalid.');
  return item;
}

function inRange(value, minimum, maximum) {
  return Number.isFinite(Number(value)) && Number(value) >= minimum && Number(value) <= maximum;
}

export const signalCatalog = Object.freeze(validateSignals(read(config.signalCatalogPath)));
export const signalByKey = new Map(signalCatalog.map((signal) => [signal.key, signal]));
export const connectorCatalog = Object.freeze(validateConnectors(read(config.connectorCatalogPath)));
export const connectorByKey = new Map(connectorCatalog.map((connector) => [connector.key, connector]));
export const scoringConfig = Object.freeze(validateScoring(read(config.scoringConfigPath)));

export function activeScoringConfig(db, tenantId) {
  const version = db.get(`SELECT config_json FROM scoring_versions
    WHERE tenant_id=? AND status='approved' ORDER BY approved_at DESC LIMIT 1`, [tenantId]);
  return version ? Object.freeze(validateScoring(json(version.config_json))) : scoringConfig;
}
