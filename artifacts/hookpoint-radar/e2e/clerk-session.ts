import type { Page } from "@playwright/test";

/**
 * Programmatic Clerk sign-in for the browser smoke journey.
 *
 * Uses the Clerk Backend API (development instance) to look up or create a
 * dedicated test user and mint a single-use sign-in token, then consumes that
 * token inside the real browser through Clerk's "ticket" strategy. The
 * resulting session is exactly what an operator gets after signing in through
 * the UI: the same cookies, the same session claims, and the same private
 * workspace derived from the verified user id.
 */

const CLERK_API = "https://api.clerk.com/v1";

/**
 * The dedicated operator account every browser spec signs in as. Its private
 * workspace is keyed by the Clerk user id, so specs reset that tenant rather
 * than creating more accounts. Override with E2E_CLERK_EMAIL (must not be a
 * `.test` address: Clerk rejects those).
 */
export const E2E_USER = {
  email: process.env.E2E_CLERK_EMAIL ?? "e2e-decision-smoke@example.com",
  firstName: "E2E",
  lastName: "Operator",
};

export interface ClerkTestUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface ClerkUserRecord {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email_addresses: Array<{ email_address: string }>;
}

function secretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) {
    throw new Error(
      "CLERK_SECRET_KEY is required to sign in a test user through the Clerk Backend API.",
    );
  }
  return key;
}

async function clerkApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${secretKey()}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(`Clerk Backend API ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

export async function ensureClerkTestUser(user: {
  email: string;
  firstName: string;
  lastName: string;
}): Promise<ClerkTestUser> {
  const existing = await clerkApi<ClerkUserRecord[]>(
    `/users?email_address=${encodeURIComponent(user.email)}&limit=1`,
  );
  const record =
    existing[0] ??
    (await clerkApi<ClerkUserRecord>("/users", {
      method: "POST",
      body: JSON.stringify({
        email_address: [user.email],
        first_name: user.firstName,
        last_name: user.lastName,
        skip_password_requirement: true,
      }),
    }));
  return {
    id: record.id,
    email: user.email,
    firstName: record.first_name ?? user.firstName,
    lastName: record.last_name ?? user.lastName,
  };
}

export async function createSignInToken(userId: string, expiresInSeconds = 300): Promise<string> {
  const token = await clerkApi<{ token: string }>("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: expiresInSeconds }),
  });
  return token.token;
}

/**
 * Ends a session server-side, exactly like an administrator revoking it from
 * the Clerk dashboard or a security policy expiring it. The browser is not
 * told: it finds out the next time it asks Clerk for a session token.
 */
export async function revokeClerkSession(sessionId: string): Promise<void> {
  const session = await clerkApi<{ status: string }>(`/sessions/${sessionId}/revoke`, { method: "POST" });
  if (session.status !== "revoked") {
    throw new Error(`Clerk session ${sessionId} was not revoked (status: ${session.status}).`);
  }
}

declare global {
  interface Window {
    Clerk?: {
      loaded?: boolean;
      client: {
        signIn: {
          create(params: { strategy: "ticket"; ticket: string }): Promise<{
            status: string;
            createdSessionId: string | null;
          }>;
        };
      };
      session?: { id: string; getToken(options?: { skipCache?: boolean }): Promise<string | null> } | null;
      setActive(params: { session: string }): Promise<void>;
    };
  }
}

/** The id of the session the page is currently signed in with. */
export async function activeClerkSessionId(page: Page): Promise<string> {
  await page.waitForFunction(() => window.Clerk?.loaded === true, null, { timeout: 30_000 });
  const sessionId = await page.evaluate(() => window.Clerk?.session?.id ?? null);
  if (!sessionId) {
    throw new Error("The page has no active Clerk session.");
  }
  return sessionId;
}

/**
 * Makes the page ask Clerk for a fresh session token right now. Clerk.js does
 * this on its own roughly once a minute (session tokens are short-lived), and
 * it is the moment a server-side revocation becomes visible to the browser:
 * the token request fails and Clerk drops the session. Forcing it keeps the
 * gate fast without changing what the app observes. The request is expected
 * to fail once the session is gone, so its result is deliberately ignored.
 */
export async function refreshClerkSessionToken(page: Page): Promise<void> {
  await page.evaluate(async () => {
    try {
      await window.Clerk?.session?.getToken({ skipCache: true });
    } catch {
      // A revoked session rejects here; the app-level reaction is what the spec asserts.
    }
  });
}

/**
 * Signs the page's browser context in as the given user. The page must be on
 * an origin that boots the application's ClerkProvider (any app route works).
 */
export async function signInWithClerk(page: Page, user: ClerkTestUser): Promise<void> {
  const ticket = await createSignInToken(user.id);
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.Clerk?.loaded === true, null, { timeout: 30_000 });
  const result = await page.evaluate(async (signInTicket) => {
    const clerk = window.Clerk!;
    const attempt = await clerk.client.signIn.create({ strategy: "ticket", ticket: signInTicket });
    if (attempt.status !== "complete" || !attempt.createdSessionId) {
      throw new Error(`Clerk ticket sign-in did not complete (status: ${attempt.status}).`);
    }
    await clerk.setActive({ session: attempt.createdSessionId });
    return attempt.status;
  }, ticket);
  if (result !== "complete") {
    throw new Error(`Unexpected Clerk sign-in status: ${result}`);
  }
}
