#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedPaths = ['lib/api-client-react/src/generated', 'lib/api-zod/src/generated'];

/** Content-only comparison works in a source ZIP, dirty checkout or clean clone. */
export function snapshotGeneratedFiles(baseDir, directories = generatedPaths) {
  const snapshot = new Map();
  const visit = (relative) => {
    const absolute = path.join(baseDir, relative);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute).sort()) visit(path.join(relative, entry));
    } else if (stat.isFile()) {
      snapshot.set(relative.split(path.sep).join('/'), createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'));
    } else {
      throw new Error('Generated API outputs must be regular files and directories.');
    }
  };
  for (const directory of directories) visit(directory);
  return snapshot;
}

export function changedGeneratedFiles(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].filter((name) => before.get(name) !== after.get(name)).sort();
}

async function main() {
  const before = snapshotGeneratedFiles(root);
  const packageManager = process.env.npm_execpath;
  const usesPnpmScript = packageManager && /pnpm\.(?:c?js|mjs)$/i.test(packageManager);
  const command = usesPnpmScript ? process.execPath : (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  const args = [...(usesPnpmScript ? [packageManager] : []), '--filter', '@workspace/api-spec', 'run', 'codegen'];
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && !usesPnpmScript });
  const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve(code ?? 1)); });
  if (status !== 0) { process.exitCode = status; return; }
  const changed = changedGeneratedFiles(before, snapshotGeneratedFiles(root));
  if (changed.length) {
    console.error('Generated API files were out of date; regeneration changed their contents:');
    for (const filename of changed) console.error(`  ${filename}`);
    console.error('Review and retain the regenerated outputs, then rerun the contract check.');
    process.exitCode = 1;
  } else {
    console.log('Generated API contents match the specification.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(`API generation check failed: ${error.message}`); process.exitCode = 1; }
}
