# Local workspace

Use Node.js 24 or newer and pnpm. From the repository root:

```sh
pnpm install
node scripts/local-demo.mjs
```

Open **http://127.0.0.1:5173/dashboard**. No Clerk account, API subscription, Replit instance or cloud database is required. The runner uses Node's built-in SQLite and process APIs, without adding a runner dependency. It works on macOS, Linux and Windows with Node and pnpm installed.

New local workspaces start **empty**. Existing workspaces retain their data and the last explicit seeding preference. Ordinary ingestion, entity resolution, recency decay, scoring, insight and workflow services run against the local database.

Assignments, status changes, notes and outcomes persist in `.local/demo/workspace.sqlite`. Stop both services with Ctrl+C. To clear every generated record from this local workspace and keep automatic fictional fixtures disabled:

```sh
node scripts/local-demo.mjs --reset --empty
```

The empty-mode preference is saved in `.local/demo/mode`, so restarting without flags—or using `--reset` alone—does not reintroduce demo data. `--empty` without `--reset` changes the preference while retaining existing data. The runner refuses a reset while another runner is active, and resets only `.local/demo/workspace.sqlite` and its SQLite sidecars. Source fixtures, application files and production databases are untouched.

To explicitly opt into the fictional demonstration again:

```sh
node scripts/local-demo.mjs --reset --seed
```

Seed mode creates ten **fictional, explicitly labeled** companies when the workspace has no companies, spanning creative pressure, a partner brief, a growth launch, stale evidence, an unresolved identity, risk suppression and recorded sales outcomes. Evidence links open inspectable fictional snapshots. The real engine computes every score and analytic; the sample does not establish real-world model accuracy or lead quality. `--seed` is remembered until `--empty` is selected. The flags cannot be combined.

For alternate ports, set `HOOKPOINT_DEMO_WEB_PORT` and `HOOKPOINT_DEMO_API_PORT` in your shell before launching it. Defaults are 5173 and 8787. A different web port requires an explicit reset and seed if you want fictional evidence links to use the new port.

## Isolation

- Both processes bind to `127.0.0.1`. Keep the preview local.
- The runner starts children with an environment allowlist. It excludes existing cloud database URLs, Clerk configuration, provider credentials and Node injection options. The explicit demo configuration does not load `.env` files.
- The API still requires authentication. A new random key is generated for each run and added by the local Vite proxy; the browser bundle receives no API key.
- Provider execution, connector configuration and webhooks are disabled in this demo server. The scheduler is off. All seeded sources are prefixed `demo_`.
- The frontend demo entry requires Vite development mode, the explicit demo flag and a loopback browser hostname. Production builds retain Clerk authentication.

## Authenticated development and deployment

The existing Express host in `artifacts/api-server` and the normal frontend remain the authenticated production path. Configure Clerk, durable storage and real providers there using `artifacts/api-server/radar-core/docs/DEPLOYMENT_AND_SECURITY.md`. Do not deploy the local runner. Normal Vite development defaults to port 5173 and `/` unless `PORT` and `BASE_PATH` are supplied.
