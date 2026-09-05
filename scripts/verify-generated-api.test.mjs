import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshotGeneratedFiles, changedGeneratedFiles } from './verify-generated-api.mjs';

test('a source directory without Git compares content and ignores timestamps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookpoint-generated-check-'));
  try {
    fs.mkdirSync(path.join(dir, 'generated'));
    const file = path.join(dir, 'generated', 'api.ts');
    fs.writeFileSync(file, 'export const version = 1;\n');
    const before = snapshotGeneratedFiles(dir, ['generated']);
    fs.utimesSync(file, new Date(0), new Date(0));
    assert.deepEqual(changedGeneratedFiles(before, snapshotGeneratedFiles(dir, ['generated'])), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('changed, added and deleted generated files fail content comparison', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookpoint-generated-check-'));
  try {
    fs.mkdirSync(path.join(dir, 'generated'));
    fs.writeFileSync(path.join(dir, 'generated', 'api.ts'), 'old');
    fs.writeFileSync(path.join(dir, 'generated', 'removed.ts'), 'removed');
    const before = snapshotGeneratedFiles(dir, ['generated']);
    fs.writeFileSync(path.join(dir, 'generated', 'api.ts'), 'new');
    fs.rmSync(path.join(dir, 'generated', 'removed.ts'));
    fs.writeFileSync(path.join(dir, 'generated', 'added.ts'), 'added');
    assert.deepEqual(changedGeneratedFiles(before, snapshotGeneratedFiles(dir, ['generated'])), ['generated/added.ts', 'generated/api.ts', 'generated/removed.ts']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
