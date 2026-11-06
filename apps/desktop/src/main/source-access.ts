import * as fs from 'fs';
import * as path from 'path';
import { resolveSourcePath, type DatabaseManager } from '@virtual-finder/core';

/** Only a successful native folder picker can authorize adding a source. */
export class SourceSelectionGrants {
  private grants = new Map<string, number>();
  grant(folderPath: string): string {
    const canonical = fs.realpathSync.native(folderPath);
    if (!fs.statSync(canonical).isDirectory()) throw new Error('Source must be a directory');
    const now = Date.now();
    for (const [folder, expiry] of this.grants) if (expiry < now) this.grants.delete(folder);
    this.grants.set(canonical, now + 5 * 60 * 1000);
    return canonical;
  }
  consume(folderPath: string): string {
    const canonical = fs.realpathSync.native(folderPath);
    const expiry = this.grants.get(canonical);
    this.grants.delete(canonical);
    if (!expiry || expiry < Date.now()) throw new Error('Select this source using the folder picker first');
    return canonical;
  }
}

export async function resolveIndexedFile(db: DatabaseManager, fileId: string): Promise<string> {
  const [file] = await db.getFileRecordsByIds([fileId]);
  if (!file) throw new Error('File is no longer indexed');
  const source = await db.getSourceById(file.source_id);
  if (!source?.enabled) throw new Error('Source is no longer enabled');
  const resolved = resolveSourcePath(source.path, file.path);
  if (!fs.statSync(resolved).isFile()) throw new Error('Indexed path is not a file');
  return resolved;
}

export async function resolveSourceFolder(db: DatabaseManager, sourceId: number, relativePath = ''): Promise<string> {
  const source = await db.getSourceById(sourceId);
  if (!source?.enabled) throw new Error('Source is no longer enabled');
  const resolved = resolveSourcePath(source.path, path.resolve(source.path, relativePath));
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Path is not a folder');
  return resolved;
}
