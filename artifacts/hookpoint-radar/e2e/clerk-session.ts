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
      setActive(params: { session: string }): Promise<void>;
    };
  }
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
