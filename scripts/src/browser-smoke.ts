/**
 * Release gate: authenticated browser smoke journey against freshly started services.
 *
 * Run with `pnpm run verify:browser-smoke` from the repo root (that script also
 * takes the lock shared with verify:api-contract so Orval never rewrites the
 * generated API client while the services here are building). The gate
 *
 *   1. starts the API Server and the Hookpoint Opportunity Radar web dev server
 *      on free ports (so it never collides with the workspace workflows),
 *   2. fronts both with a tiny same-origin proxy that mirrors the workspace
 *      path routing (`/api/*` -> API, everything else -> web),
 *   3. waits for `/api/health` and the web root to answer,
 *   4. runs the Playwright journey in `artifacts/hookpoint-radar/e2e/`,
 *   5. tears everything down and, on failure, points at the traces and
 *      screenshots Playwright kept under `.e2e-artifacts/`.
 *
 * Required environment:
 *   CLERK_SECRET_KEY           Clerk Backend API key (workspace secret).
 * Optional environment:
 *   BROWSER_SMOKE_STARTUP_MS   How long to wait for the services (default 180000).
 *   E2E_CHROMIUM_PATH, E2E_DATABASE_PATH, E2E_CLERK_EMAIL are forwarded to Playwright.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const artifactsDir = path.join(repoRoot, ".e2e-artifacts", "hookpoint-radar");
const startupTimeoutMs = Number(process.env.BROWSER_SMOKE_STARTUP_MS ?? 180_000);
const proxyHost = "localhost";

const log = (message: string) => console.log(`[browser-smoke] ${message}`);
class GateFailure extends Error {}
const fail = (message: string): never => {
  throw new GateFailure(message);
};

interface Service {
  name: string;
  child: ChildProcess;
  exited: Promise<number | null>;
}

const services: Service[] = [];
let proxy: http.Server | undefined;

async function main(): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) {
    fail("CLERK_SECRET_KEY is not set; the journey cannot mint a Clerk sign-in ticket.");
  }

  const [apiPort, webPort, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const origin = `http://${proxyHost}:${proxyPort}`;

  log(`starting API Server on :${apiPort}`);
  startService("api-server", ["--filter", "@workspace/api-server", "run", "dev"], {
    PORT: String(apiPort),
    NODE_ENV: "development",
  });

  log(`starting web dev server on :${webPort}`);
  startService("web", ["--filter", "@workspace/hookpoint-radar", "run", "dev"], {
    PORT: String(webPort),
    BASE_PATH: "/",
  });

  proxy = startOriginProxy(proxyPort, { apiPort, webPort });
  log(`serving both behind ${origin} (/api -> :${apiPort}, / -> :${webPort})`);

  await waitForHttp(`${origin}/api/health`, "API Server /api/health");
  await waitForHttp(`${origin}/`, "web dev server");

  fs.rmSync(artifactsDir, { recursive: true, force: true });

  log("running the authenticated browser journey");
  const exitCode = await runPlaywright(origin);

  if (exitCode !== 0) {
    reportArtifacts();
    fail(`browser smoke journey FAILED (playwright exit code ${exitCode}).`);
  }
  log("browser smoke journey passed.");
}

function startService(name: string, pnpmArgs: string[], env: NodeJS.ProcessEnv): Service {
  const child = spawn("pnpm", pnpmArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group so the whole pnpm -> shell -> node tree can be killed.
    detached: true,
  });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .forEach((line) => console.log(`[${name}] ${line}`));
  child.stdout?.on("data", prefix);
  child.stderr?.on("data", prefix);

  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", (error) => {
      console.error(`[${name}] failed to start: ${error.message}`);
      resolve(null);
    });
  });
  const service = { name, child, exited };
  services.push(service);
  return service;
}

function startOriginProxy(port: number, targets: { apiPort: number; webPort: number }): http.Server {
  const targetFor = (url: string | undefined) =>
    url === "/api" || url?.startsWith("/api/") ? targets.apiPort : targets.webPort;

  const server = http.createServer((req, res) => {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: targetFor(req.url),
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          "x-forwarded-host": req.headers.host ?? `${proxyHost}:${port}`,
          "x-forwarded-proto": "http",
        },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`origin proxy: upstream error: ${error.message}`);
    });
    req.pipe(upstream);
  });

  // Vite's HMR client opens a websocket against the page origin; relay the
  // raw upgrade so the dev server does not sit in "[vite] connecting...".
  server.on("upgrade", (req, socket, head) => {
    const upstream = net.connect(targetFor(req.url), "127.0.0.1", () => {
      const headerLines = Object.entries(req.headers)
        .flatMap(([key, value]) =>
          Array.isArray(value) ? value.map((v) => `${key}: ${v}`) : value ? [`${key}: ${value}`] : [],
        )
        .join("\r\n");
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headerLines}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  server.listen(port, "127.0.0.1");
  return server;
}

async function waitForHttp(url: string, label: string): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = "no response yet";
  while (Date.now() < deadline) {
    const dead = services.find((service) => service.child.exitCode !== null);
    if (dead) {
      fail(`${dead.name} exited early (code ${dead.child.exitCode}) while waiting for ${label}.`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        log(`${label} is up (${response.status} ${url})`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  fail(`${label} did not become ready within ${startupTimeoutMs}ms (${lastError}).`);
}

function runPlaywright(origin: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["--filter", "@workspace/hookpoint-radar", "run", "test:e2e"], {
      cwd: repoRoot,
      env: { ...process.env, E2E_BASE_URL: origin },
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(`[browser-smoke] could not launch playwright: ${error.message}`);
      resolve(1);
    });
  });
}

function reportArtifacts(): void {
  const files = listFiles(artifactsDir).filter((file) => /\.(zip|png|webm|txt|md)$/.test(file));
  if (files.length === 0) {
    console.error(`[browser-smoke] no traces or screenshots were written under ${artifactsDir}.`);
    return;
  }
  console.error("[browser-smoke] Playwright kept these artifacts for the failed steps:");
  for (const file of files) {
    console.error(`  ${path.relative(repoRoot, file)}`);
  }
  const trace = files.find((file) => file.endsWith(".zip"));
  if (trace) {
    console.error(
      `[browser-smoke] inspect a trace with (from the repo root): pnpm exec playwright show-trace ${path.relative(repoRoot, trace)}`,
    );
  }
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not allocate a free port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function shutdown(): Promise<void> {
  proxy?.close();
  for (const service of services) {
    if (service.child.exitCode !== null || service.child.pid === undefined) continue;
    try {
      process.kill(-service.child.pid, "SIGTERM");
    } catch {
      // Process group already gone.
    }
  }
  const grace = sleep(5_000).then(() => "timeout" as const);
  const outcome = await Promise.race([Promise.all(services.map((service) => service.exited)), grace]);
  if (outcome === "timeout") {
    for (const service of services) {
      if (service.child.exitCode === null && service.child.pid !== undefined) {
        try {
          process.kill(-service.child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
  }
}

let shuttingDown = false;
const exitWith = (code: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  void shutdown().finally(() => process.exit(code));
};

process.on("SIGINT", () => exitWith(130));
process.on("SIGTERM", () => exitWith(143));
// Last line of defence for abrupt exits: never leave the dev servers running.
process.on("exit", () => {
  for (const service of services) {
    if (service.child.exitCode === null && service.child.pid !== undefined) {
      try {
        process.kill(-service.child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
});

main()
  .then(() => exitWith(0))
  .catch((error: unknown) => {
    const detail =
      error instanceof GateFailure
        ? error.message
        : error instanceof Error
          ? (error.stack ?? error.message)
          : String(error);
    console.error(`[browser-smoke] ${detail}`);
    exitWith(1);
  });
