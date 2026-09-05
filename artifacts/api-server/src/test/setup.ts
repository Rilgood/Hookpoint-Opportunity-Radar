/**
 * Environment for the api-server test suite.
 *
 * Runs before any test file is imported. The radar core reads its
 * configuration once at import time, so everything it needs has to be in
 * place here, not inside a test.
 */

// Keep the tests off the workspace's managed Postgres and the on-disk SQLite
// file: every run gets a fresh in-memory database.
delete process.env.DATABASE_URL;
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

// Exercise production-like authentication: a request without a Clerk session
// or a valid API key must be rejected rather than falling back to the
// local-development principal.
process.env.AUTH_REQUIRED = "true";

// Bootstraps an admin API key in the in-memory database so the API-key path
// can be tested end to end. Both values must be at least 32 characters.
process.env.ADMIN_API_KEY = "test-admin-api-key-0123456789abcdef0123456789";
process.env.HASH_SALT = "test-hash-salt-0123456789abcdef0123456789abcdef";

// The Clerk middleware needs keys with a valid shape even though the tests
// never contact Clerk. Fresh checkouts have no Clerk secrets, so provide
// syntactically valid development placeholders when none are configured.
const placeholderFrontendApi = Buffer.from("clerk.example.test$").toString("base64");
process.env.CLERK_PUBLISHABLE_KEY ??= `pk_test_${placeholderFrontendApi}`;
process.env.CLERK_SECRET_KEY ??= "sk_test_placeholder_secret_key_for_api_server_tests";
