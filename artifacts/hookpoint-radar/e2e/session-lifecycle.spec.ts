import { expect, test, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test";
import {
  activeClerkSessionId,
  E2E_USER,
  ensureClerkTestUser,
  refreshClerkSessionToken,
  revokeClerkSession,
  signInWithClerk,
  type ClerkTestUser,
} from "./clerk-session";
import { openRadarDatabase, resetTenant, type RadarDatabase } from "./radar-db";

/**
 * Session lifecycle smoke journey: the half that decision-smoke does not cover.
 *
 * Signing in is proven by the decision journey. This spec proves that a
 * session also *ends* correctly, through the same real Clerk session, the
 * same path-routed API, and nothing mocked:
 *
 *   1. an operator who logs out lands on the public page, cannot reach a
 *      protected route without being sent back to sign-in, and the browser's
 *      cookies no longer authorize /api/v1 calls;
 *   2. a session revoked server-side (Clerk dashboard, security policy,
 *      expiry) sends the operator back to the sign-in screen the moment the
 *      browser next talks to Clerk, instead of leaving stale data or a blank
 *      page behind, and the API stops accepting the browser afterwards.
 *
 * Both scenarios must complete without the app throwing or logging errors.
 */

test.describe.configure({ mode: "serial" });

/** Route the app protects; also the route sign-in returns operators to. */
const PROTECTED_ROUTE = "/dashboard";
/** Cheapest authenticated read the API offers. */
const PROTECTED_API = "/api/v1/companies";

test.describe("session lifecycle: sign-out and revocation", () => {
  let db: RadarDatabase;
  let user: ClerkTestUser;
  let context: BrowserContext;
  let page: Page;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    user = await ensureClerkTestUser(E2E_USER);
    db = openRadarDatabase();
    context = await browser.newContext();
    page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      const failure = appConsoleError(message, page);
      if (failure) consoleErrors.push(failure);
    });
  });

  test.afterAll(async () => {
    await context?.close();
    if (db) {
      // The first authenticated request recreates the private workspace; leave
      // the shared development database exactly as we found it.
      resetTenant(db, user.id);
      db.close();
    }
  });

  test("logging out clears the dashboard and protected API access", async () => {
    await signInWithClerk(page, user);
    await page.goto(PROTECTED_ROUTE);
    await expect(page.getByText(user.email)).toBeVisible();
    const signedIn = await page.request.get(PROTECTED_API);
    expect(signedIn.status(), await signedIn.text()).toBe(200);
    expect(sessionCookieNames(await context.cookies()).length).toBeGreaterThan(0);

    // Log out the way an operator does: through the account menu in the shell.
    await page.getByTestId("button-user-menu").click();
    await page.getByTestId("menu-item-logout").click();

    // Sign-out lands on the public landing page with no trace of the workspace.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    await expect(page.getByText(user.email)).toHaveCount(0);
    await expect(page.getByTestId("button-user-menu")).toHaveCount(0);

    // Protected routes bounce straight back to sign-in.
    await page.goto(PROTECTED_ROUTE);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(page.getByText(user.email)).toHaveCount(0);

    // The browser's cookie jar no longer authorizes the API. `page.request`
    // shares the context's cookies, so this is exactly what a leftover tab or
    // a bookmarked API call would get after logging out.
    expect(sessionCookieNames(await context.cookies())).toEqual([]);
    const signedOut = await page.request.get(PROTECTED_API);
    expect(signedOut.status(), await signedOut.text()).toBe(401);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("a session revoked server-side returns the operator to sign-in", async () => {
    await signInWithClerk(page, user);
    await page.goto(PROTECTED_ROUTE);
    await expect(page.getByText(user.email)).toBeVisible();
    const sessionId = await activeClerkSessionId(page);

    // Revoke from the backend while the dashboard is open. The browser is not
    // notified; it learns about it on its next token refresh.
    await revokeClerkSession(sessionId);
    await refreshClerkSessionToken(page);

    // The app reacts on its own: no reload, no blank page, no stale dashboard.
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(page.getByText(user.email)).toHaveCount(0);
    await expect(page.getByTestId("button-user-menu")).toHaveCount(0);

    // Clerk dropped the session cookie along with the session, so the API
    // refuses the browser from here on.
    expect(sessionCookieNames(await context.cookies())).toEqual([]);
    const revoked = await page.request.get(PROTECTED_API);
    expect(revoked.status(), await revoked.text()).toBe(401);

    // A revoked session cannot be resumed by revisiting a protected route.
    await page.goto(PROTECTED_ROUTE);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText("Welcome back")).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

/** Clerk's session-token cookies (`__session` plus the suffixed per-instance copy). */
function sessionCookieNames(cookies: Array<{ name: string }>): string[] {
  return cookies.map((cookie) => cookie.name).filter((name) => name.startsWith("__session"));
}

/**
 * Console errors that count against the app. Chromium also logs a network-level
 * "Failed to load resource" line when Clerk's own API answers 401 for the
 * revoked session; that response is the mechanism under test, not a defect,
 * so it is excluded only when it originates from a different origin than the
 * app. Anything the app logs, and any failed request to the app's own origin,
 * is reported.
 */
function appConsoleError(message: ConsoleMessage, page: Page): string | null {
  if (message.type() !== "error") return null;
  const text = message.text();
  const source = message.location().url;
  const appOrigin = new URL(page.url()).origin;
  const isForeignResourceFailure =
    text.startsWith("Failed to load resource") && source !== "" && !source.startsWith(appOrigin);
  if (isForeignResourceFailure) return null;
  return source ? `${text} (${source})` : text;
}
