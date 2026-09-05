import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { isEphemeralSqlitePath } from '../src/storage-path.js';

test('SQLite in memory and system temporary directories is classified as ephemeral', () => {
  assert.equal(isEphemeralSqlitePath(':memory:'), true);
  assert.equal(isEphemeralSqlitePath(path.join(os.tmpdir(), 'radar', 'workspace.sqlite')), true);
  assert.equal(isEphemeralSqlitePath('/tmp/radar.sqlite', { pathApi: path.posix }), true);
  assert.equal(isEphemeralSqlitePath('/private/tmp/radar.sqlite', { pathApi: path.posix }), true);
  assert.equal(isEphemeralSqlitePath('/var/folders/user/T/radar.sqlite', { pathApi: path.posix, tempDir: '/var/folders/user/T' }), true);
  assert.equal(isEphemeralSqlitePath('/private/var/folders/user/T/radar.sqlite', { pathApi: path.posix, tempDir: '/var/folders/user/T' }), true);
  assert.equal(isEphemeralSqlitePath('/var/folders/user/T/radar.sqlite', { pathApi: path.posix, tempDir: '/private/var/folders/user/T' }), true);
});

test('temporary path recognition uses directory boundaries rather than string prefixes', () => {
  const options = { pathApi: path.posix, tempDir: '/var/folders/user/T' };
  assert.equal(isEphemeralSqlitePath('/tmp-archive/radar.sqlite', options), false);
  assert.equal(isEphemeralSqlitePath('/var/folders/user/T-backup/radar.sqlite', options), false);
  assert.equal(isEphemeralSqlitePath('/private/tmp/../storage/radar.sqlite', options), false);
});

test('Windows system temporary paths are ephemeral while a separate durable volume is not', () => {
  const options = { pathApi: path.win32, tempDir: 'C:\\Users\\Operator\\AppData\\Local\\Temp' };
  assert.equal(isEphemeralSqlitePath('C:\\Users\\Operator\\AppData\\Local\\Temp\\radar.sqlite', options), true);
  assert.equal(isEphemeralSqlitePath('C:\\Users\\Operator\\AppData\\Local\\Temp-backup\\radar.sqlite', options), false);
  assert.equal(isEphemeralSqlitePath('D:\\data\\radar.sqlite', options), false);
});
