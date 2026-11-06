import * as fs from 'fs';
import * as path from 'path';

/** Compare path segments, never string prefixes or case-folded paths. */
export function isPathWithinSource(sourcePath: string, candidatePath: string): boolean {
  const relative = path.relative(sourcePath, candidatePath);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Resolve symlinks before authorizing an existing filesystem read or open. */
export function resolveSourcePath(sourcePath: string, candidatePath: string): string {
  const source = fs.realpathSync.native(sourcePath);
  const candidate = fs.realpathSync.native(candidatePath);
  if (!fs.statSync(source).isDirectory() || !isPathWithinSource(source, candidate)) {
    throw new Error('Path is outside the selected source');
  }
  return candidate;
}
