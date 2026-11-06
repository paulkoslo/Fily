import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

/** VACUUM INTO includes committed WAL pages; copying just the .db file does not. */
export function createMigrationBackup(db: InstanceType<typeof Database>, version: number): string | undefined {
  if (!db.name || db.name === ':memory:') return;
  const directory = `${path.resolve(db.name)}.backups`;
  let backup: string | undefined;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Backup location must be a real directory');
    fs.chmodSync(directory, 0o700);
    const candidate = path.join(directory, `before-v${version}-${Date.now()}-${randomUUID()}.db`);
    // Reserve an empty private file exclusively; SQLite accepts an empty destination.
    const reserved = fs.openSync(candidate, 'wx', 0o600);
    fs.closeSync(reserved);
    backup = candidate;
    db.prepare('VACUUM main INTO ?').run(backup);
    const copy = new Database(backup, { readonly: true, fileMustExist: true });
    try {
      const results = copy.pragma('quick_check') as Array<{ quick_check: string }>;
      if (results.length !== 1 || results[0].quick_check !== 'ok') throw new Error('Backup failed SQLite integrity validation');
    } finally {
      copy.close();
    }
    const file = fs.openSync(backup, 'r');
    try { fs.fsyncSync(file); } finally { fs.closeSync(file); }
    const folder = fs.openSync(directory, 'r');
    try { fs.fsyncSync(folder); } finally { fs.closeSync(folder); }
    return backup;
  } catch (error) {
    if (backup) fs.rmSync(backup, { force: true });
    throw new Error('Could not create a verified library backup; no migrations were applied. Check disk space and backup directory permissions.', { cause: error });
  }
}
