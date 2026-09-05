import os from 'node:os';
import path from 'node:path';

/** Classify SQLite storage without opening the database or following credentials. */
export function isEphemeralSqlitePath(databasePath, { tempDir = os.tmpdir(), pathApi = path } = {}) {
  if (databasePath === ':memory:') return true;
  const candidate = pathApi.resolve(databasePath);
  const temporaryRoots = [tempDir, '/tmp', '/private/tmp'];
  // macOS exposes /var through /private/var. Either spelling can reach the
  // same system temporary directory without changing the storage durability.
  if (pathApi.sep === '/') {
    if (tempDir.startsWith('/var/')) temporaryRoots.push(`/private${tempDir}`);
    if (tempDir.startsWith('/private/var/')) temporaryRoots.push(tempDir.slice('/private'.length));
  }
  return temporaryRoots.some((root) => {
    const relative = pathApi.relative(pathApi.resolve(root), candidate);
    return relative === '' || (!relative.startsWith(`..${pathApi.sep}`) && relative !== '..' && !pathApi.isAbsolute(relative));
  });
}
