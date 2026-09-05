import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_USER, ensureClerkTestUser, signInWithClerk, type ClerkTestUser } from "./clerk-session";
import {
  activateIndependentScoringVersion,
  getApprovedScoringVersion,
  getScoringVersion,
  openRadarDatabase,
  type RadarDatabase,
  resetTenant,
  seedCalibrationCohort,
} from "./radar-db";

/**
 * Authenticated decision smoke journey.
 *
 * One real Clerk session drives the deployed development stack through the
 * operator's origin. Nothing is mocked: the browser talks to the path-routed
 * API, the API verifies the Clerk session and derives the private workspace,
 * and every decision below lands in the real database. The journey covers the
 * three operator-visible outcomes that the component suite cannot prove
 * without a live session:
 *
 *   1. a signed-in operator loads a seeded opportunity, confirms its identity,
 *      and sees the refreshed review state;
 *   2. an authorized administrator sees a useful error when an approval is
 *      rejected, without losing the dashboard they were working in;
 *   3. the same administrator can re-evaluate and approve a recommendation.
 *
 * The private-workspace model grants the workspace owner both operator (write)
 * and administrator scopes, so a single dedicated account plays both roles.
 * The other half of the session lifecycle (sign-out, revocation) lives in
 * session-lifecycle.spec.ts.
 */

const runId = `e2e${Date.now().toString(36)}`;

test.describe.configure({ mode: "serial" });

test.describe("authenticated decision smoke journey", () => {
  let db: RadarDatabase;
  let user: ClerkTestUser;
  let context: BrowserContext;
  let page: Page;
  const pageErrors: string[] = [];

  let opportunityId: string;
  let opportunityName: string;
  let staleProposalId: string;
  let independentVersion: string;

  test.beforeAll(async ({ browser }) => {
    user = await ensureClerkTestUser(E2E_USER);
    db = openRadarDatabase();
    // The workspace is keyed by the verified Clerk user id. Start every run from
    // a first-sign-in state so evaluations and approvals are deterministic.
    resetTenant(db, user.id);

    context = await browser.newContext();
    page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await signInWithClerk(page, user);
  });

  test.afterAll(async () => {
    await context?.close();
    if (db) {
      resetTenant(db, user.id);
      db.close();
    }
  });

  test("signed-in operator loads a seeded opportunity and confirms its identity", async () => {
    await page.goto("/dashboard");
    await expect(page.getByText(user.email)).toBeVisible();

    // Seed through the authenticated API: this is the same session cookie the
    // browser uses, so it also proves proxy routing and Clerk verification for
    // non-document requests.
    opportunityName = `E2E Decision Smoke ${runId}`;
    const created = await page.request.post("/api/v1/companies", {
      data: { name: opportunityName, domain: `${runId}.example.com`, industry: "Healthcare" },
    });
    expect(created.status(), await created.text()).toBe(201);
    const createdBody = (await created.json()) as { data: { id: string; identity_review_status: string } };
    opportunityId = createdBody.data.id;
    expect(createdBody.data.identity_review_status).not.toBe("confirmed");

    await page.goto(`/opportunities/${opportunityId}`);
    await expect(page.getByRole("heading", { name: opportunityName })).toBeVisible();
    const reviewStatus = page.getByText("Review status", { exact: true }).locator("xpath=following-sibling::*[1]");
    await expect(reviewStatus).toHaveText("Unreviewed");

    await page.getByRole("button", { name: "Confirm identity" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Confirm authoritative identity")).toBeVisible();
    await expect(dialog.getByPlaceholder("Enter the verified value")).toHaveValue(`${runId}.example.com`);

    const [confirmResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/companies/${opportunityId}/identity/confirm`) &&
          response.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Confirm identity" }).click(),
    ]);
    expect(confirmResponse.status(), await confirmResponse.text()).toBe(200);

    await expect(page.getByText("Identity review saved", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(reviewStatus).toHaveText("Confirmed");
    // The audit trail attributes the decision to the verified Clerk principal.
    await expect(page.getByText(`clerk:${user.id}`).first()).toBeVisible();

    const detail = await page.request.get(`/api/v1/companies/${opportunityId}`);
    expect(detail.status()).toBe(200);
    const detailBody = (await detail.json()) as {
      data: { company: { identity_method: string }; identity_review: { status: string } };
    };
    expect(detailBody.data.identity_review.status).toBe("confirmed");
    expect(detailBody.data.company.identity_method).toBe("reviewed_domain");
    expect(pageErrors).toEqual([]);
  });

  test("administrator sees a useful error for a rejected approval without losing the dashboard", async () => {
    seedCalibrationCohort(db, user.id, { runId });

    await page.goto("/dashboard");
    await expect(page.getByText("Outcome Calibration")).toBeVisible();

    const [evaluation] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/analytics/outcomes/evaluate") && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Evaluate holdout" }).click(),
    ]);
    expect(evaluation.status(), await evaluation.text()).toBe(200);
    const evaluationBody = (await evaluation.json()) as {
      data: { status: string; recommendation?: { id: string; version: string; status: string } };
    };
    expect(evaluationBody.data.status).toBe("ready");
    staleProposalId = evaluationBody.data.recommendation!.id;
    const staleVersion = evaluationBody.data.recommendation!.version;
    expect(staleVersion).toMatch(/^rules-1\.1-cal-\d{8}$/);
    await expect(page.getByText(`Proposed ${staleVersion}`)).toBeVisible();
    const approveButton = page.getByRole("button", { name: "Approve score version" });
    await expect(approveButton).toBeVisible();

    // Another administrator activates an independently reviewed version while
    // this proposal is still on screen, making the on-screen proposal stale.
    const staleProposal = getScoringVersion(db, user.id, staleProposalId);
    expect(staleProposal?.status).toBe("proposed");
    independentVersion = activateIndependentScoringVersion(db, user.id, staleProposal!, {
      runId,
      actor: `e2e:independent-administrator-${runId}`,
    });

    const [approval] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/analytics/outcomes/recommendations/${staleProposalId}/approve`) &&
          response.request().method() === "POST",
      ),
      approveButton.click(),
    ]);
    expect(approval.status()).toBe(409);
    const approvalBody = (await approval.json()) as { error: { code: string; message: string } };
    expect(approvalBody.error.code).toBe("score_recommendation_stale");

    // Operator-visible explanation of *why* it failed, the right next step, and the working view survives.
    const rejection = page.getByTestId("approval-rejection");
    await expect(rejection).toBeVisible();
    await expect(rejection).toHaveAttribute("data-rejection-code", "score_recommendation_stale");
    await expect(rejection).toContainText("A newer score version was activated.");
    await expect(rejection).toContainText("The current score version remains unchanged.");
    await expect(rejection).toContainText("Next step: Re-run the evaluation to propose weights against the current version.");
    await expect(page.getByRole("button", { name: "Evaluate holdout" })).toHaveAttribute("data-highlighted", "true");
    await expect(page.getByText(`Proposed ${staleVersion}`)).toBeVisible();
    await expect(page.getByText("Outcome Calibration")).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(getScoringVersion(db, user.id, staleProposalId)?.status).toBe("proposed");
    expect(getApprovedScoringVersion(db, user.id)?.version).toBe(independentVersion);
    expect(pageErrors).toEqual([]);
  });

  test("administrator re-evaluates and approves the score recommendation", async () => {
    const [evaluation] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/analytics/outcomes/evaluate") && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Evaluate holdout" }).click(),
    ]);
    expect(evaluation.status(), await evaluation.text()).toBe(200);
    const evaluationBody = (await evaluation.json()) as {
      data: { status: string; reason?: string; recommendation?: { id: string; version: string } };
    };
    expect(evaluationBody.data.status, evaluationBody.data.reason).toBe("ready");
    const recommendation = evaluationBody.data.recommendation!;
    expect(recommendation.id).not.toBe(staleProposalId);
    expect(recommendation.version.startsWith(`${independentVersion}-cal-`)).toBe(true);
    await expect(page.getByText(`Proposed ${recommendation.version}`)).toBeVisible();
    // The stale-approval explanation is cleared once a fresh evaluation replaces it.
    await expect(page.getByTestId("approval-rejection")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Evaluate holdout" })).not.toHaveAttribute("data-highlighted", "true");

    const [approval] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/analytics/outcomes/recommendations/${recommendation.id}/approve`) &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Approve score version" }).click(),
    ]);
    expect(approval.status(), await approval.text()).toBe(200);

    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve score version" })).toHaveCount(0);
    await expect(page.getByText("Outcome Calibration")).toBeVisible();

    const approved = getApprovedScoringVersion(db, user.id);
    expect(approved?.id).toBe(recommendation.id);
    expect(approved?.approved_by).toBe(`clerk:${user.id}`);
    expect(getScoringVersion(db, user.id, staleProposalId)?.status).toBe("proposed");
    expect(pageErrors).toEqual([]);
  });
});
