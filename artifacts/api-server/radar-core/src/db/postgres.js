import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';

/**
 * Synchronous Postgres adapter.
 *
 * radar-core was written against node:sqlite, whose API is synchronous, and
 * every service, job and test calls the database boundary (`run`, `get`,
 * `all`, `exec`, `transaction`) without awaiting. To move operational data
 * onto managed Postgres without rewriting that call graph, this adapter runs
 * the `pg` driver on a worker thread that owns one connection, and the calling
 * thread blocks on a SharedArrayBuffer until each statement's result arrives
 * (`Atomics.wait` + `receiveMessageOnPort`, the same pattern used by tools that
 * expose synchronous APIs over asynchronous drivers).
 *
 * Semantics preserved from the SQLite adapter:
 * - statements are strictly serialised on one connection, so `BEGIN`/`COMMIT`
 *   issued through `transaction()` always share that connection;
 * - `?` placeholders (rewritten to `$n`), booleans bound as 1/0, `undefined`
 *   bound as NULL;
 * - integer and numeric aggregates are returned as JavaScript numbers.
 *
 * The event loop is blocked for the round trip of each statement, exactly as it
 * already is for node:sqlite; the difference is that a Postgres round trip is a
 * network hop (sub-millisecond on Replit, where the database is co-located).
 */

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const signal = new Int32Array(workerData.signal);
const port = workerData.port;

function reply(message) {
  port.postMessage(message);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}

function serializeError(error) {
  return {
    message: String(error && error.message || error),
    code: error && error.code,
    constraint: error && error.constraint,
    table: error && error.table,
    column: error && error.column,
    detail: error && error.detail,
    severity: error && error.severity,
    routine: error && error.routine,
  };
}

(async () => {
  let pg;
  try {
    const mod = await import(workerData.pgModule);
    pg = mod.default && mod.default.Client ? mod.default : mod;
    pg.types.setTypeParser(20, (value) => Number(value));   // int8 (COUNT, SUM of integers)
    pg.types.setTypeParser(1700, (value) => Number(value)); // numeric (AVG, ROUND)
  } catch (error) {
    reply({ ready: false, error: serializeError(error) });
    return;
  }

  let client = null;
  let connecting = null;

  async function connect() {
    const next = new pg.Client({
      connectionString: workerData.url,
      statement_timeout: workerData.statementTimeoutMs,
      connectionTimeoutMillis: workerData.statementTimeoutMs,
      application_name: 'hookpoint-radar',
    });
    next.on('error', () => { if (client === next) client = null; });
    next.on('end', () => { if (client === next) client = null; });
    await next.connect();
    await next.query('SET search_path TO ' + workerData.searchPath);
    return next;
  }

  async function ensureClient() {
    if (client) return client;
    if (!connecting) {
      connecting = connect().then((connected) => { client = connected; return connected; }).finally(() => { connecting = null; });
    }
    return connecting;
  }

  async function handle(message) {
    if (message.kind === 'close') {
      const current = client;
      client = null;
      if (current) await current.end().catch(() => {});
      return { ok: true };
    }
    const active = await ensureClient();
    const result = message.params
      ? await active.query({ text: message.sql, values: message.params })
      : await active.query(message.sql);
    const last = Array.isArray(result) ? result[result.length - 1] : result;
    return { ok: true, rows: last ? last.rows : [], rowCount: last && last.rowCount != null ? last.rowCount : 0, command: last ? last.command : undefined };
  }

  // Requests are handled strictly one at a time (the main thread blocks until
  // each reply arrives) and every reply carries the request id it answers.
  let currentId = null;
  port.on('message', async (message) => {
    currentId = message.id;
    try {
      reply({ id: message.id, ...(await handle(message)) });
    } catch (error) {
      reply({ id: message.id, ok: false, error: serializeError(error) });
    } finally {
      currentId = null;
    }
  });
  // The main thread cannot observe worker 'error'/'exit' events while it is
  // blocked, so answer the in-flight request before an unexpected crash
  // instead of leaving it to the statement timeout.
  for (const event of ['uncaughtException', 'unhandledRejection']) {
    process.on(event, (error) => {
      if (currentId != null) reply({ id: currentId, ok: false, error: serializeError(error) });
      currentId = null;
    });
  }
  reply({ id: 0, ready: true });
})();
`;

export class PostgresSyncClient {
  constructor(url, { schema, pgModule, statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS } = {}) {
    if (!IDENTIFIER.test(schema)) throw new Error(`Postgres schema name "${schema}" must be a lowercase identifier.`);
    this.dialect = 'postgres';
    this.native = null;
    this.schema = schema;
    this.statementTimeoutMs = statementTimeoutMs;
    this.closed = false;
    this.nextId = 1;
    this.signal = new Int32Array(new SharedArrayBuffer(4));
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        url,
        pgModule,
        signal: this.signal.buffer,
        port: channel.port2,
        searchPath: `"${schema}"`,
        statementTimeoutMs,
      },
      transferList: [channel.port2],
    });
    this.worker.on('error', (error) => { this.workerError = error; });
    this.worker.unref();
    this.port.unref();
    const ready = this.await('startup', 0);
    if (!ready.ready) {
      this.terminate();
      throw new Error(`Postgres worker failed to start: ${ready.error?.message || 'unknown error'}`);
    }
  }

  /**
   * Blocks until the reply for request `id` is on the port. The worker posts
   * the message before it flips the shared flag, so the message is normally
   * already queued when the wait returns; if it is not yet visible, or a
   * stale reply from an abandoned request is queued first, keep waiting until
   * the matching reply arrives or the overall deadline passes.
   */
  await(label, id) {
    const deadline = Date.now() + this.statementTimeoutMs + 5_000;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        this.terminate();
        throw new Error(`Postgres ${label} did not complete within ${this.statementTimeoutMs}ms; the database connection was abandoned.`);
      }
      // 'not-equal' means the worker already flipped the flag: no wakeup can be lost.
      Atomics.wait(this.signal, 0, 0, Math.min(remaining, 50));
      Atomics.store(this.signal, 0, 0);
      let received;
      while ((received = receiveMessageOnPort(this.port))) {
        if (received.message.id === id) return received.message;
      }
      if (this.workerError) {
        this.terminate();
        throw new Error(`Postgres ${label} failed: the database worker crashed (${this.workerError.message}).`);
      }
    }
  }

  request(message) {
    if (this.closed) throw new Error('The Postgres connection is closed.');
    const id = this.nextId++;
    Atomics.store(this.signal, 0, 0);
    this.port.postMessage({ id, ...message });
    const response = this.await(message.kind, id);
    if (!response.ok) throw postgresError(response.error, message.sql);
    return response;
  }

  query(sql, params = []) {
    return this.request({ kind: 'query', sql: translatePlaceholders(sql), params: params.map(bindValue) }).rows;
  }

  run(sql, params = []) {
    const response = this.request({ kind: 'query', sql: translatePlaceholders(sql), params: params.map(bindValue) });
    return { changes: response.rowCount };
  }

  exec(sql) {
    const { command } = this.request({ kind: 'exec', sql });
    return { command };
  }

  columns(table) {
    return this.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position`,
      [table]
    ).map((row) => row.column_name);
  }

  tables() {
    return this.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`
    ).map((row) => row.table_name);
  }

  // Explicitly created indexes only, matching the SQLite driver: indexes that
  // back PRIMARY KEY/UNIQUE constraints are excluded because each engine names
  // those automatically.
  indexes() {
    return this.query(
      `SELECT c.relname AS name FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema()
          AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)
        ORDER BY c.relname`
    ).map((row) => row.name);
  }

  close() {
    if (this.closed) return;
    try { this.request({ kind: 'close' }); } catch { /* the worker is terminated below regardless */ }
    this.terminate();
  }

  terminate() {
    this.closed = true;
    this.worker.terminate();
    this.port.close();
  }
}

export function postgresError(details, sql) {
  const error = new Error(details.message);
  error.code = details.code;
  error.constraint = details.constraint;
  error.table = details.table;
  error.column = details.column;
  error.detail = details.detail;
  error.severity = details.severity;
  error.sql = sql;
  return error;
}

export function translatePlaceholders(sql) {
  let index = 0;
  let output = '';
  let quoted = false;
  for (let position = 0; position < sql.length; position += 1) {
    const character = sql[position];
    if (character === "'") quoted = !quoted;
    if (character === '?' && !quoted) {
      index += 1;
      output += `$${index}`;
    } else {
      output += character;
    }
  }
  return output;
}

function bindValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}
