/**
 * Operator-facing explanations for failed score-calibration requests.
 *
 * Both the holdout evaluation and the approval that follows it can be rejected
 * by the API with an error envelope of the shape `{ error: { code, message } }`.
 * Each recognised code maps to a plain-language headline, an explanation of the
 * cause, and the concrete next step, so the operator knows whether to wait for
 * more data, ask an administrator, or actually retry.
 */

export type OperatorFacingError<Code extends string> = {
  code: Code;
  /** Plain-language headline stating what happened. */
  title: string;
  /** Explanation of why the request failed. */
  message: string;
  /** The concrete next step for the operator. */
  action: string;
};

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const apiError = (data as { error?: unknown }).error;
  if (!apiError || typeof apiError !== "object") return null;
  const code = (apiError as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * Pick the catalogue entry for a failed request: a recognised error code wins,
 * otherwise well-known HTTP statuses are mapped, otherwise `unknown`.
 */
function resolveCode<Code extends string>(
  error: unknown,
  known: readonly Code[],
  byStatus: Partial<Record<number, Code>>,
  fallback: Code,
): Code {
  const rawCode = readErrorCode(error);
  if (rawCode && rawCode !== fallback && (known as readonly string[]).includes(rawCode)) {
    return rawCode as Code;
  }
  const status = readStatus(error);
  if (status !== null && byStatus[status]) return byStatus[status] as Code;
  return fallback;
}

// ---------------------------------------------------------------------------
// Holdout evaluation
// ---------------------------------------------------------------------------

/**
 * Why a holdout evaluation produced no approval-ready recommendation.
 *
 * The API reports guardrail outcomes as a successful response with
 * `status: "blocked"` plus the `guardrails` counts it checked, so most of these
 * codes are derived client-side from those counts rather than from an error
 * envelope. `insufficient_scope`, `rate_limited` and `unknown` come from
 * genuine request failures.
 */
export type EvaluationFailureCode =
  | "holdout_unavailable"
  | "training_unavailable"
  | "snapshots_missing"
  | "no_improvement"
  | "blocked"
  | "insufficient_scope"
  | "rate_limited"
  | "unknown";

export type EvaluationFailure = OperatorFacingError<EvaluationFailureCode> & {
  /**
   * "blocked": the evaluation ran but the guardrails produced no recommendation.
   * "error": the request itself failed.
   */
  kind: "blocked" | "error";
  /** Whether simply re-running the evaluation is a reasonable next step. */
  retryable: boolean;
};

/** The subset of the API's ScoreCalibrationEvaluation the explanations depend on. */
export type BlockedEvaluationLike = {
  status?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  guardrails?: Partial<{
    holdout_accounts: number;
    qualified_accounts: number;
    negative_accounts: number;
    minimum_sample: number;
    min_each_class: number;
    training_accounts: number;
    training_qualified_accounts: number;
    training_negative_accounts: number;
    minimum_training_sample: number;
    min_training_each_class: number;
    scored_holdout_accounts: number;
    scored_training_accounts: number;
  }> | null;
};

const NOTHING_CHANGED = "No recommendation was produced and the active score version is unchanged.";
const RETRY_WONT_HELP = "Re-running the evaluation will not change this until more outcomes are labeled.";

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function shortfall(current: number | null, minimum: number | null, noun: string): string | null {
  if (current === null || minimum === null || current >= minimum) return null;
  return plural(minimum - current, `more ${noun}`);
}

/** Describe the holdout requirement, e.g. "needs at least 30 labels with 10 qualified and 10 negative; it currently has 12 (5 qualified / 7 negative)". */
function holdoutShortfallMessage(g: NonNullable<BlockedEvaluationLike["guardrails"]>): string {
  const holdout = count(g.holdout_accounts);
  const qualified = count(g.qualified_accounts);
  const negative = count(g.negative_accounts);
  const minimum = count(g.minimum_sample);
  const minEach = count(g.min_each_class);

  const requirement =
    minimum !== null && minEach !== null
      ? `needs at least ${plural(minimum, "label")} with ${minEach} qualified and ${minEach} negative outcomes`
      : minimum !== null
        ? `needs at least ${plural(minimum, "label")}`
        : "does not yet have enough labels";
  const current =
    holdout !== null
      ? qualified !== null && negative !== null
        ? `; it currently has ${holdout} (${qualified} qualified / ${negative} negative)`
        : `; it currently has ${holdout}`
      : "";
  const needs = [
    shortfall(holdout, minimum, "label"),
    shortfall(qualified, minEach, "qualified outcome"),
    shortfall(negative, minEach, "negative outcome"),
  ].filter((part): part is string => part !== null);
  const gap = needs.length ? ` At least ${needs.join(" and ")} are required.` : "";
  return `The holdout ${requirement}${current}.${gap}`;
}

function trainingShortfallMessage(g: NonNullable<BlockedEvaluationLike["guardrails"]>): string {
  const training = count(g.training_accounts);
  const qualified = count(g.training_qualified_accounts);
  const negative = count(g.training_negative_accounts);
  const minimum = count(g.minimum_training_sample);
  const minEach = count(g.min_training_each_class);

  const requirement =
    minimum !== null && minEach !== null
      ? `needs at least ${plural(minimum, "label")} with ${minEach} in each class`
      : minimum !== null
        ? `needs at least ${plural(minimum, "label")}`
        : "does not yet have enough labels";
  const current =
    training !== null
      ? qualified !== null && negative !== null
        ? `; it currently has ${training} (${qualified} qualified / ${negative} negative)`
        : `; it currently has ${training}`
      : "";
  return `The earlier labels used to propose new weights ${requirement}${current}.`;
}

/** True when both values are known and the current count is under the minimum. */
function below(current: unknown, minimum: unknown): boolean {
  const c = count(current);
  const m = count(minimum);
  return c !== null && m !== null && c < m;
}

function holdoutIsShort(g: NonNullable<BlockedEvaluationLike["guardrails"]>): boolean {
  return (
    below(g.holdout_accounts, g.minimum_sample) ||
    below(g.qualified_accounts, g.min_each_class) ||
    below(g.negative_accounts, g.min_each_class)
  );
}

function trainingIsShort(g: NonNullable<BlockedEvaluationLike["guardrails"]>): boolean {
  return (
    below(g.training_accounts, g.minimum_training_sample) ||
    below(g.training_qualified_accounts, g.min_training_each_class) ||
    below(g.training_negative_accounts, g.min_training_each_class)
  );
}

function snapshotsAreMissing(g: NonNullable<BlockedEvaluationLike["guardrails"]>): boolean {
  return below(g.scored_holdout_accounts, g.holdout_accounts) || below(g.scored_training_accounts, g.training_accounts);
}

/**
 * Explain a `status: "blocked"` evaluation from the guardrail counts the API
 * returns. The checks mirror the server's guardrail order: holdout size and
 * class balance, then training size, then missing score snapshots, then the
 * AUC-lift comparison (signalled by the presence of before/after metrics).
 */
export function describeBlockedEvaluation(evaluation: BlockedEvaluationLike): EvaluationFailure {
  const g = evaluation.guardrails ?? {};
  const serverReason = typeof evaluation.reason === "string" && evaluation.reason.trim() ? evaluation.reason.trim() : null;

  if (holdoutIsShort(g)) {
    return {
      code: "holdout_unavailable",
      kind: "blocked",
      title: "Not enough recent held-out labels to evaluate.",
      message: `The evaluation tests proposed weights only against the most recent labeled outcomes. ${holdoutShortfallMessage(g)} ${RETRY_WONT_HELP}`,
      action: "Keep recording qualifying and negative outcomes, then evaluate again once the holdout is large enough.",
      retryable: false,
    };
  }
  if (trainingIsShort(g)) {
    return {
      code: "training_unavailable",
      kind: "blocked",
      title: "Not enough earlier labels to propose new weights.",
      message: `${trainingShortfallMessage(g)} ${RETRY_WONT_HELP}`,
      action: "Keep recording qualifying and negative outcomes, then evaluate again.",
      retryable: false,
    };
  }
  if (snapshotsAreMissing(g)) {
    const scoredHoldout = count(g.scored_holdout_accounts);
    const holdout = count(g.holdout_accounts);
    const scoredTraining = count(g.scored_training_accounts);
    const training = count(g.training_accounts);
    const detail =
      scoredHoldout !== null && holdout !== null && scoredTraining !== null && training !== null
        ? ` Only ${scoredHoldout} of ${holdout} holdout labels and ${scoredTraining} of ${training} training labels have one.`
        : "";
    return {
      code: "snapshots_missing",
      kind: "blocked",
      title: "Some labeled accounts have no historic score to compare against.",
      message: `Every labeled account needs the score it had when the outcome was recorded.${detail} Re-running the evaluation will not recover the missing history.`,
      action: "Rescore accounts and collect new labeled outcomes, then evaluate again.",
      retryable: false,
    };
  }
  if (evaluation.before !== undefined || evaluation.after !== undefined) {
    return {
      code: "no_improvement",
      kind: "blocked",
      title: "The proposed weights did not beat the current score version.",
      message: `${serverReason ?? "The candidate weights did not improve holdout discrimination by the required margin."} ${NOTHING_CHANGED}`,
      action: "No action is needed; the current weights stay in place. Evaluate again after more outcomes are labeled.",
      retryable: false,
    };
  }
  return {
    code: "blocked",
    kind: "blocked",
    title: "Recommendation blocked by guardrails",
    message: serverReason ?? NOTHING_CHANGED,
    action: "Review the guardrail reason above; retrying without new labeled outcomes will produce the same result.",
    retryable: false,
  };
}

const EVALUATION_ERRORS: Record<
  Extract<EvaluationFailureCode, "insufficient_scope" | "rate_limited" | "unknown">,
  Omit<EvaluationFailure, "code" | "kind">
> = {
  insufficient_scope: {
    title: "Administrator permission is required.",
    message: `Your account can view calibration results but cannot run a holdout evaluation. ${NOTHING_CHANGED}`,
    action: "Ask a workspace administrator to run the evaluation.",
    retryable: false,
  },
  rate_limited: {
    title: "Too many requests in a short time.",
    message: `The API temporarily declined the evaluation because this workspace sent requests too quickly. ${NOTHING_CHANGED}`,
    action: "Wait a minute, then evaluate again.",
    retryable: true,
  },
  unknown: {
    title: "Unable to evaluate this cohort.",
    message: `The evaluation did not complete. ${NOTHING_CHANGED}`,
    action: "Try again in a moment. If it keeps failing, contact support.",
    retryable: true,
  },
};

type EvaluationErrorCode = keyof typeof EVALUATION_ERRORS;
const EVALUATION_ERROR_CODES = Object.keys(EVALUATION_ERRORS) as EvaluationErrorCode[];

/**
 * Translate a failed evaluation *request* (non-2xx) into an operator-facing
 * explanation. A 403 without a recognised code is treated as a permission
 * problem and a 429 as rate limiting; anything else falls back to a generic
 * message. Guardrail outcomes arrive as a successful response instead — see
 * describeBlockedEvaluation.
 */
export function describeEvaluationFailure(error: unknown): EvaluationFailure {
  const code = resolveCode<EvaluationErrorCode>(
    error,
    EVALUATION_ERROR_CODES,
    { 403: "insufficient_scope", 429: "rate_limited" },
    "unknown",
  );
  return { code, kind: "error", ...EVALUATION_ERRORS[code] };
}

// ---------------------------------------------------------------------------
// Score approval
// ---------------------------------------------------------------------------

export type ApprovalRejectionCode =
  | "score_recommendation_stale"
  | "score_recommendation_not_pending"
  | "score_approval_conflict"
  | "insufficient_scope"
  | "unknown";

export type ApprovalRejection = OperatorFacingError<ApprovalRejectionCode> & {
  /** Whether re-running the holdout evaluation is the fix; the card highlights that button when true. */
  promptReevaluation: boolean;
};

const UNCHANGED = "The current score version remains unchanged.";

const APPROVAL_REJECTIONS: Record<ApprovalRejectionCode, Omit<ApprovalRejection, "code">> = {
  score_recommendation_stale: {
    title: "A newer score version was activated.",
    message: `This recommendation was evaluated against an older scoring version, so it can no longer be approved. ${UNCHANGED}`,
    action: "Re-run the evaluation to propose weights against the current version.",
    promptReevaluation: true,
  },
  score_recommendation_not_pending: {
    title: "This recommendation is no longer pending.",
    message: `It was already approved or superseded, so there is nothing left to approve. ${UNCHANGED}`,
    action: "Refresh the dashboard to see the active score version, or re-run the evaluation to propose new weights.",
    promptReevaluation: true,
  },
  score_approval_conflict: {
    title: "Another score version was approved first.",
    message: `A different scoring version became active for this workspace while you were reviewing, so this one was not applied. ${UNCHANGED}`,
    action: "Re-run the evaluation so the proposal is based on the version that is now active.",
    promptReevaluation: true,
  },
  insufficient_scope: {
    title: "Administrator permission is required.",
    message: `Your account can evaluate score recommendations but cannot approve them. ${UNCHANGED}`,
    action: "Ask a workspace administrator to approve this recommendation.",
    promptReevaluation: false,
  },
  unknown: {
    title: "Approval could not be saved.",
    message: UNCHANGED,
    action: "Try again in a moment. If it keeps failing, re-run the evaluation and contact support if the problem persists.",
    promptReevaluation: false,
  },
};

const APPROVAL_CODES = Object.keys(APPROVAL_REJECTIONS) as ApprovalRejectionCode[];

/**
 * Translate a failed approval request into an operator-facing explanation.
 * A 403 without a recognised code is treated as a permission problem.
 */
export function describeApprovalRejection(error: unknown): ApprovalRejection {
  const code = resolveCode<ApprovalRejectionCode>(error, APPROVAL_CODES, { 403: "insufficient_scope" }, "unknown");
  return { code, ...APPROVAL_REJECTIONS[code] };
}
