export type ApprovalRejectionCode =
  | "score_recommendation_stale"
  | "score_recommendation_not_pending"
  | "score_approval_conflict"
  | "insufficient_scope"
  | "unknown";

export type ApprovalRejection = {
  code: ApprovalRejectionCode;
  /** Plain-language headline stating what happened. */
  title: string;
  /** Explanation of why the approval was rejected. */
  message: string;
  /** The concrete next step for the operator. */
  action: string;
  /** Whether re-running the holdout evaluation is the fix; the card highlights that button when true. */
  promptReevaluation: boolean;
};

const UNCHANGED = "The current score version remains unchanged.";

const REJECTIONS: Record<ApprovalRejectionCode, Omit<ApprovalRejection, "code">> = {
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
 * Translate a failed approval request into an operator-facing explanation.
 * Codes come from the API's error envelope (`{ error: { code, message } }`);
 * a 403 without a recognised code is treated as a permission problem.
 */
export function describeApprovalRejection(error: unknown): ApprovalRejection {
  const rawCode = readErrorCode(error);
  let code: ApprovalRejectionCode = "unknown";
  if (rawCode && rawCode in REJECTIONS && rawCode !== "unknown") {
    code = rawCode as ApprovalRejectionCode;
  } else if (readStatus(error) === 403) {
    code = "insufficient_scope";
  }
  return { code, ...REJECTIONS[code] };
}
