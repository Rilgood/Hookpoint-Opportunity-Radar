import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Authenticated browser smoke journey for the Hookpoint Opportunity Radar.
//
// The suite drives the *running* development stack (web + API workflows) through
// the same path-routed origin the operator uses, signs in with a real Clerk
// session, and exercises identity confirmation and score approval end to end.
// `pnpm run verify:browser-smoke` (scripts/src/browser-smoke.ts) starts both
// services on free ports behind a local proxy and runs this suite as a release
// gate; set E2E_BASE_URL to point the suite at any other origin.
//
// Required environment:
//   CLERK_SECRET_KEY   Clerk Backend API key for the development instance
//                      (already present in the workspace secrets).
// Optional environment:
//   E2E_BASE_URL       Origin serving the app. Defaults to https://$REPLIT_DEV_DOMAIN.
//   E2E_CHROMIUM_PATH  Chromium binary. Defaults to the workspace chromium when
//                      present; otherwise Playwright's bundled browser is used.
//   E2E_DATABASE_PATH  Radar SQLite file used by the running API server.
//                      Defaults to artifacts/api-server/data/hookpoint-radar.sqlite.

const devDomain = process.env.REPLIT_DEV_DOMAIN;
const baseURL = process.env.E2E_BASE_URL ?? (devDomain ? `https://${devDomain}` : undefined);

const workspaceChromium = "/repl/tools/bin/chromium";
const executablePath =
  process.env.E2E_CHROMIUM_PATH ??
  (fs.existsSync(workspaceChromium) ? workspaceChromium : undefined);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  // The journey mutates one dedicated tenant, so it must never run in parallel.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  // Traces and screenshots must live outside the Vite root: writes inside the
  // artifact directory trigger dev-server reloads that keep the app from booting.
  outputDir: path.resolve(import.meta.dirname, "../../.e2e-artifacts/hookpoint-radar"),
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath,
      args: ["--no-sandbox"],
    },
  },
});
