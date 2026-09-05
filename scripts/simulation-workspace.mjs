#!/usr/bin/env node
// Disposable browser verification workspace: real API/engine, in-memory SQLite,
// synthetic inputs through HTTP, no provider credentials or persistent lead data.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webPort = 5174;
const apiPort = 8788;
const origin = `http://127.0.0.1:${webPort}`;

if (process.argv[2] !== "--isolated-child") {
  const env = Object.fromEntries(
    ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  const key = randomBytes(32).toString("hex");
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "--isolated-child"],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...env,
        NODE_ENV: "development",
        HOOKPOINT_LOCAL_DEMO: "true",
        HOST: "127.0.0.1",
        DATABASE_URL: "",
        DATABASE_PATH: ":memory:",
        DEFAULT_TENANT_ID: "tenant_browser_simulation",
        AUTH_REQUIRED: "true",
        ADMIN_API_KEY: key,
        HOOKPOINT_DEMO_API_KEY: key,
        HASH_SALT: randomBytes(32).toString("hex"),
        SCHEDULER_ENABLED: "false",
        LOG_LEVEL: "error",
        PORT: String(webPort),
        HOOKPOINT_DEMO_API_PORT: String(apiPort),
        BASE_PATH: "/",
        ALLOWED_ORIGINS: origin,
      },
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code || 0;
  });
} else {
  assert.equal(process.env.DATABASE_PATH, ":memory:");
  assert.equal(process.env.DATABASE_URL, "");
  const [{ openDatabase }, { createApp }] = await Promise.all([
    import("../artifacts/api-server/radar-core/src/db/index.js"),
    import("../artifacts/api-server/radar-core/src/app.js"),
  ]);
  const db = openDatabase(":memory:");
  const handler = createApp(db, { serveStaticAssets: false });
  const server = http.createServer((req, res) => {
    if (
      (req.headers.origin && req.headers.origin !== origin) ||
      (req.method !== "GET" &&
        /^\/api\/v1\/(connectors|webhooks)(\/|$)/.test(req.url))
    ) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: "simulation_boundary",
            message:
              "External operations are disabled in this isolated simulation.",
          },
        }),
      );
      return;
    }
    return handler(req, res);
  });
  let web;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    web?.kill("SIGTERM");
    server.close(() => {
      db.close();
    });
    server.closeAllConnections();
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(apiPort, "127.0.0.1", resolve);
    });
    const request = async (route, body) => {
      const response = await fetch(
        `http://127.0.0.1:${apiPort}/api/v1/${route}`,
        {
          method: body ? "POST" : "GET",
          headers: {
            "x-api-key": process.env.ADMIN_API_KEY,
            "content-type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      const result = await response.json();
      assert.equal(response.ok, true, JSON.stringify(result));
      return result.data;
    };
    assert.equal((await request("dashboard")).companies, 0);
    const time = Date.now();
    const records = [];
    const company = (name, domain) => ({
      name: `${name} (Simulation)`,
      ...(domain ? { domain: `${domain}.example` } : {}),
      industry: "Retail",
      employee_count: 120,
    });
    const ready = company("Evidence Ready", "evidence-ready");
    const risk = company("Risk Hold", "risk-hold");
    const stale = company("Historical Only", "historical-only");
    const identity = company("Identity Review");
    const advice = company("General Advice", "general-advice");
    function add(
      account,
      type,
      title,
      attributes,
      age = 1,
      publisher = "source.example",
    ) {
      records.push({
        source: "simulation_intake",
        external_id: `sim-${records.length + 1}`,
        type,
        company: account,
        title,
        body: "Synthetic verification record; not a real event or commercial claim.",
        attributes: { ...attributes, synthetic: true },
        confidence: 0.95,
        observed_at: new Date(time - age * 86_400_000).toISOString(),
        retrieved_at: new Date(time).toISOString(),
        event_time_quality: "reported",
        url: `https://${publisher}/verification/${records.length + 1}`,
      });
    }
    add(ready, "rfp", "Synthetic company is seeking a creative agency", {
      explicit_agency_search: true,
    });
    add(
      ready,
      "campaign_metric",
      "Synthetic acquisition cost rose 35%",
      { cac_delta_pct: 35, roas_delta_pct: -30 },
      1,
      "analytics.example",
    );
    add(
      ready,
      "creative_metric",
      "Synthetic creative has concentrated opening hooks",
      { hook_diversity_score: 20 },
      1,
      "creative.example",
    );
    add(ready, "product_launch", "Synthetic product launch announced", {
      is_new: true,
    });
    add(
      ready,
      "crm_activity",
      "Synthetic strategy session requested",
      { demo_requested: true, relationship: "referral" },
      0.5,
      "crm.example",
    );
    add(risk, "crisis", "Synthetic critical data breach", {
      severity: "critical",
    });
    add(
      risk,
      "crisis",
      "Synthetic independent critical data breach confirmation",
      { severity: "critical" },
      0.5,
      "independent.example",
    );
    add(
      stale,
      "funding",
      "Synthetic old funding announcement",
      { amount: 5000000 },
      200,
    );
    add(
      identity,
      "rfp",
      "Synthetic name-only company is seeking a creative agency",
      { explicit_agency_search: true },
    );
    add(identity, "creative_metric", "Synthetic name-only creative metric", {
      hook_diversity_score: 20,
    });
    add(
      advice,
      "news",
      "How to choose an agency: we are not seeking a creative agency",
      {},
    );
    const intake = await request("ingest", { records });
    assert.equal(intake.rejected, 0);
    assert.equal(intake.inserted, records.length);
    const replay = await request("ingest", { records });
    assert.equal(replay.inserted, 0);
    assert.equal(replay.duplicates, records.length);
    const accounts = (await request("companies")).data;
    assert.equal(accounts.length, 5);
    assert.equal(
      accounts.find((row) => row.name === ready.name).opportunity_tier,
      "hot",
    );
    assert.equal(
      accounts.find((row) => row.name === risk.name).opportunity_tier,
      "suppressed",
    );
    for (const account of accounts.filter((row) =>
      [stale.name, advice.name].includes(row.name),
    )) {
      const detail = await request(`companies/${account.id}`);
      assert.equal(
        detail.signals.filter((signal) => signal.status === "active").length,
        0,
      );
    }
    const require = createRequire(
      path.join(root, "artifacts/hookpoint-radar/package.json"),
    );
    const vite = path.join(
      path.dirname(require.resolve("vite/package.json")),
      "bin/vite.js",
    );
    web = spawn(process.execPath, [vite], {
      cwd: path.join(root, "artifacts/hookpoint-radar"),
      env: process.env,
      stdio: "inherit",
    });
    web.once("exit", () => stop());
    web.once("error", (error) => {
      console.error(error.message);
      stop();
    });
    console.log(
      `Simulation assertions passed. Browser workspace: ${origin}/dashboard`,
    );
    console.log(
      JSON.stringify(
        accounts.map(({ id, name, opportunity_tier }) => ({
          id,
          name,
          tier: opportunity_tier,
        })),
        null,
        2,
      ),
    );
    console.log(
      "In-memory records disappear on Ctrl+C; the main workspace stays empty. No external sources are contacted.",
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    stop();
  }
}
