import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';

// config.js resolves the catalog directory once, at import time, so each case
// below runs in a fresh Node process instead of trying to re-import the module.
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogFiles = ['signal-catalog.json', 'connector-catalog.json', 'scoring.json'];

function loadConfigIn(env) {
  const script = "import('./src/config.js').then((m) => process.stdout.write(JSON.stringify({ configDir: m.config.configDir, scoringConfigPath: m.config.scoringConfigPath })))";
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_PATH: ':memory:', ...env },
    encoding: 'utf8'
  }));
}

test('catalogs default to the config directory shipped with this package', () => {
  const expected = path.join(packageDir, 'config');
  assert.equal(config.configDir, expected);
  for (const file of catalogFiles) assert.ok(fs.existsSync(path.join(expected, file)), `${file} exists`);
  assert.equal(config.signalCatalogPath, path.join(expected, 'signal-catalog.json'));
  assert.equal(config.connectorCatalogPath, path.join(expected, 'connector-catalog.json'));
  assert.equal(config.scoringConfigPath, path.join(expected, 'scoring.json'));
});

test('RADAR_CONFIG_DIR redirects catalog paths, which is how the bundled api-server host reads radar-core/config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-config-'));
  for (const file of catalogFiles) fs.copyFileSync(path.join(packageDir, 'config', file), path.join(dir, file));
  const loaded = loadConfigIn({ RADAR_CONFIG_DIR: dir });
  assert.equal(loaded.configDir, dir);
  assert.equal(loaded.scoringConfigPath, path.join(dir, 'scoring.json'));

  const relative = loadConfigIn({ RADAR_CONFIG_DIR: './config' });
  assert.equal(relative.configDir, path.join(packageDir, 'config'));
});

test('a RADAR_CONFIG_DIR without the catalog files fails at import instead of scoring with defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-config-empty-'));
  assert.throws(() => loadConfigIn({ RADAR_CONFIG_DIR: dir }), (error) => {
    const output = `${error.stderr || ''}${error.stdout || ''}`;
    return output.includes('radar-core config directory') && output.includes('signal-catalog.json') && output.includes('RADAR_CONFIG_DIR');
  });
});
