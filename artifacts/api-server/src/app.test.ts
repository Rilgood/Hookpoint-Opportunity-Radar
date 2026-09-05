import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HealthCheckResponse } from "@workspace/api-zod";

// The Clerk session itself is verified by Clerk's middleware; these tests
// cover what the app does with the verdict. Only `getAuth` is replaced so the
// real middleware chain (proxy, CORS, Clerk, radar gate, JSON parser) still
// runs for every request.
const getAuthMock = vi.fn<() => { userId: string | null; sessionClaims?: Record<string, unknown> } | null>(
  () => ({ userId: null }),
);

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return { ...actual, getAuth: (...args: unknown[]) => getAuthMock(...(args as [])) };
});

const { default: app } = await import("./app");

const ADMIN_API_KEY = process.env.ADMIN_API_KEY!;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

afterEach(() => {
  getAuthMock.mockImplementation(() => ({ userId: null }));
});

type JsonResponse = { status: number; body: any; headers: Headers };

async function request(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string } = {},
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { accept: "application/json", ...options.headers },
    body: options.body,
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON bodies are returned verbatim so the assertion can show them.
  }
  return { status: response.status, body, headers: response.headers };
}

function signedInAs(userId: string) {
  getAuthMock.mockImplementation(() => ({ userId, sessionClaims: { userId } }));
}

describe("public routes", () => {
  it("GET /api/healthz answers with the HealthCheckResponse contract", async () => {
    const res = await request("GET", "/api/healthz");
    expect(res.status).toBe(200);
    expect(HealthCheckResponse.parse(res.body)).toEqual({ status: "ok" });
  });

  it("GET /api/health reaches the radar core without authentication", async () => {
    const res = await request("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "ok", service: "hookpoint-opportunity-radar" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("GET /api/ready reports readiness with the schema version", async () => {
    const res = await request("GET", "/api/ready");
    expect([200, 503]).toContain(res.status);
    expect(res.body.data).toMatchObject({ status: expect.stringMatching(/^(ready|not_ready)$/) });
    expect(res.body.data.schema_version).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.issues)).toBe(true);
  });
});

describe("authentication gate for /api/v1", () => {
  it("rejects a request with neither a Clerk session nor an API key", async () => {
    const res = await request("GET", "/api/v1/dashboard");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("rejects writes without credentials before touching the body", async () => {
    const res = await request("POST", "/api/v1/companies", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme" }),
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("rejects an invalid API key instead of falling back to a browser session", async () => {
    // A signed-in Clerk session must not rescue a request that presents a bad key.
    signedInAs("user_with_session");
    const res = await request("GET", "/api/v1/dashboard", { headers: { "x-api-key": "not-a-real-key" } });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "invalid_api_key" });
    expect(res.body.meta.request_id).toEqual(expect.any(String));
  });

  it("rejects an empty API key header rather than treating it as absent", async () => {
    const res = await request("GET", "/api/v1/dashboard", { headers: { "x-api-key": "" } });
    expect(res.status).toBe(401);
  });

  it("does not gate non-radar API routes on a Clerk session", async () => {
    const res = await request("GET", "/api/healthz");
    expect(res.status).toBe(200);
  });
});

describe("authenticated radar routes", () => {
  it("serves the dashboard summary to a Clerk-signed-in user in a private workspace", async () => {
    signedInAs("user_clerk_dashboard");
    const res = await request("GET", "/api/v1/dashboard");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: expect.any(Object),
      meta: { request_id: expect.any(String), duration_ms: expect.any(Number) },
    });
    expect(res.body.data).toMatchObject({
      companies: expect.any(Number),
      hot: expect.any(Number),
      warm: expect.any(Number),
      watch: expect.any(Number),
    });
  });

  it("scopes a Clerk user to their own workspace", async () => {
    signedInAs("user_clerk_alpha");
    const created = await request("POST", "/api/v1/companies", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha Only Co", domain: "alpha-only.example" }),
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ id: expect.stringMatching(/^co_/), name: "Alpha Only Co" });

    const own = await request("GET", "/api/v1/companies");
    expect(own.status).toBe(200);
    expect(own.body.data.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.body.data.id })]),
    );

    signedInAs("user_clerk_beta");
    const other = await request("GET", `/api/v1/companies/${created.body.data.id}`);
    expect(other.status).toBe(404);
  });

  it("serves the API metadata to a valid API key with the expected shape", async () => {
    const res = await request("GET", "/api/v1/meta", { headers: { "x-api-key": ADMIN_API_KEY } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: "Hook Point Opportunity Radar",
      version: expect.any(String),
      scoring_version: expect.any(String),
      storage_mode: "ephemeral_sqlite",
      observation_types: expect.any(Array),
      implemented_connectors: expect.any(Array),
    });
  });

  it("lets a valid API key create a company and read it back", async () => {
    const headers = { "x-api-key": ADMIN_API_KEY, "content-type": "application/json" };
    const created = await request("POST", "/api/v1/companies", {
      headers,
      body: JSON.stringify({ name: "Key Created Co", domain: "key-created.example", industry: "Retail" }),
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      id: expect.stringMatching(/^co_/),
      name: "Key Created Co",
      domain: "key-created.example",
      industry: "Retail",
    });

    const detail = await request("GET", `/api/v1/companies/${created.body.data.id}`, { headers });
    expect(detail.status).toBe(200);
    expect(detail.body.data.company).toMatchObject({ id: created.body.data.id, name: "Key Created Co" });
  });

  it("returns a structured 404 for an unknown radar route", async () => {
    const res = await request("GET", "/api/v1/does-not-exist", { headers: { "x-api-key": ADMIN_API_KEY } });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "route_not_found" });
  });
});

describe("request body validation", () => {
  const headers = { "x-api-key": ADMIN_API_KEY, "content-type": "application/json" };

  it("rejects a body that is not valid JSON", async () => {
    const res = await request("POST", "/api/v1/companies", { headers, body: "{not json" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "invalid_json" });
  });

  it("rejects a company without a name or domain", async () => {
    const res = await request("POST", "/api/v1/companies", { headers, body: JSON.stringify({ industry: "Retail" }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "company_name_required" });
  });

  it("rejects a company payload that is not an object", async () => {
    const res = await request("POST", "/api/v1/companies", { headers, body: JSON.stringify(["Acme"]) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "invalid_company" });
  });

  it("rejects out-of-range numeric fields", async () => {
    const res = await request("POST", "/api/v1/companies", {
      headers,
      body: JSON.stringify({ name: "Acme", employee_count: -5 }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toEqual(expect.any(String));
    expect(res.body.error.message).toEqual(expect.any(String));
  });

  it("rejects connector settings whose enabled flag is not a boolean", async () => {
    const res = await request("PATCH", "/api/v1/connectors/google_sheets", {
      headers,
      body: JSON.stringify({ enabled: "yes" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "invalid_connector_settings" });
  });
});
