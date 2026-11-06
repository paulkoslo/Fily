const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { DatabaseManager } = require('../dist/db');
const { runMigrations } = require('../dist/db/migrations');

const initial = { version: 1, name: 'initial', up(db) {
  db.exec('CREATE TABLE documents (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
} };
const upgrade = { version: 2, name: 'summary', up(db) {
  db.exec('ALTER TABLE documents ADD COLUMN summary TEXT');
} };
function withLibrary(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fily-migrations-'));
  const filename = path.join(directory, 'library.db');
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  try { return run(db, filename, directory); }
  finally { if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}
function versions(db) { return db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version); }

test('fresh libraries migrate without backup and current libraries do no work', () => {
  withLibrary((db, filename) => {
    assert.equal(runMigrations(db, [initial, upgrade]), undefined);
    assert.deepEqual(versions(db), [1, 2]);
    assert.equal(fs.existsSync(`${filename}.backups`), false);
    assert.equal(runMigrations(db, [initial, upgrade]), undefined);
    assert.equal(fs.existsSync(`${filename}.backups`), false);
  });
});

test('pre-upgrade backup includes committed WAL data, has private permissions and can be restored', () => {
  withLibrary((db, filename, directory) => {
    runMigrations(db, [initial]);
    db.prepare('INSERT INTO documents (title) VALUES (?)').run('A report committed in WAL');
    assert.ok(fs.statSync(`${filename}-wal`).size > 0);
    const backup = runMigrations(db, [initial, upgrade]);
    assert.equal(path.dirname(backup), `${filename}.backups`);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.dirname(backup)).mode & 0o777, 0o700);
    }
    const restoredPath = path.join(directory, 'restored.db');
    fs.copyFileSync(backup, restoredPath);
    const restored = new Database(restoredPath);
    try {
      assert.equal(restored.pragma('quick_check', { simple: true }), 'ok');
      assert.deepEqual(versions(restored), [1]);
      assert.equal(restored.prepare('SELECT title FROM documents').pluck().get(), 'A report committed in WAL');
      assert.equal(restored.prepare('SELECT count(*) FROM pragma_table_info(?) WHERE name = ?').pluck().get('documents', 'summary'), 0);
      runMigrations(restored, [initial, upgrade]);
      assert.deepEqual(versions(restored), [1, 2]);
      assert.equal(restored.prepare('SELECT title FROM documents').pluck().get(), 'A report committed in WAL');
    } finally { restored.close(); }
  });
});

test('a later failing migration rolls back the entire pending upgrade and retains its backup', () => {
  withLibrary((db, filename) => {
    runMigrations(db, [initial]);
    db.prepare('INSERT INTO documents (title) VALUES (?)').run('Keep my document');
    const broken = { version: 3, name: 'broken', up(connection) {
      connection.exec("UPDATE documents SET title = 'wrong'; CREATE TABLE temporary_upgrade (id INTEGER); SELECT * FROM nonexistent_table");
    } };
    assert.throws(() => runMigrations(db, [initial, upgrade, broken]), /rolled back.*Recovery backup/);
    assert.deepEqual(versions(db), [1]);
    assert.equal(db.prepare('SELECT title FROM documents').pluck().get(), 'Keep my document');
    assert.equal(db.prepare("SELECT count(*) FROM sqlite_master WHERE name = 'temporary_upgrade'").pluck().get(), 0);
    assert.equal(db.prepare('SELECT count(*) FROM pragma_table_info(?) WHERE name = ?').pluck().get('documents', 'summary'), 0);
    assert.equal(fs.readdirSync(`${filename}.backups`).length, 1);
    // The original connection remains usable and the same upgrade can be retried.
    runMigrations(db, [initial, upgrade]);
    assert.deepEqual(versions(db), [1, 2]);
  });
});

test('backup creation failure prevents every migration and preserves the library', () => {
  withLibrary((db, filename) => {
    runMigrations(db, [initial]);
    fs.writeFileSync(`${filename}.backups`, 'Block the backup directory');
    let ran = false;
    assert.throws(() => runMigrations(db, [initial, { ...upgrade, up() { ran = true; } }]), /no migrations were applied/);
    assert.equal(ran, false);
    assert.deepEqual(versions(db), [1]);
  });
});

test('symbolic backup directories and future schema versions are rejected without changing data', () => {
  withLibrary((db, filename, directory) => {
    runMigrations(db, [initial]);
    const outside = path.join(directory, 'other');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, `${filename}.backups`, 'dir');
    assert.throws(() => runMigrations(db, [initial, upgrade]), /no migrations were applied/);
    assert.deepEqual(fs.readdirSync(outside), []);
    fs.unlinkSync(`${filename}.backups`);
    db.prepare('INSERT INTO schema_migrations VALUES (99, ?, ?)').run('future', Date.now());
    assert.throws(() => runMigrations(db, [initial, upgrade]), /newer or incompatible/);
    assert.equal(fs.existsSync(`${filename}.backups`), false);
    assert.deepEqual(versions(db), [1, 99]);
  });
});

test('legacy unversioned libraries are backed up before the tracking table is created', () => {
  withLibrary((db, filename) => {
    db.exec("CREATE TABLE legacy_data (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO legacy_data VALUES (1, 'saved')");
    const backup = runMigrations(db, [initial]);
    const copy = new Database(backup, { readonly: true });
    try {
      assert.equal(copy.prepare('SELECT value FROM legacy_data').pluck().get(), 'saved');
      assert.equal(copy.prepare("SELECT count(*) FROM sqlite_master WHERE name = 'schema_migrations'").pluck().get(), 0);
    } finally { copy.close(); }
    assert.deepEqual(versions(db), [1]);
  });
});

test('the actual v5 to v6 application upgrade preserves sources, file content and placements', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fily-real-upgrade-'));
  const filename = path.join(directory, 'library.db');
  let manager;
  try {
    manager = new DatabaseManager(filename);
    const source = await manager.addSource('Library', path.join(directory, 'documents'));
    await manager.upsertFile('report-id', path.join(source.path, 'report.txt'), 'report.txt', 'txt', 100, 100, source.id, 'report.txt', null);
    await manager.upsertFileContent('report-id', 'text', 'Report content', 'Report summary', [], null, 'fixture-v1', null, []);
    await manager.upsertVirtualPlacementBatch([{ file_id: 'report-id', virtual_path: '/Reports/report.txt', tags: [], confidence: .9, reason: 'report' }], 'fixture-v1');
    await manager.close();
    const legacy = new Database(filename);
    legacy.exec('DROP INDEX idx_file_content_tags; ALTER TABLE file_content DROP COLUMN tags; DELETE FROM schema_migrations WHERE version = 6');
    legacy.close();
    manager = new DatabaseManager(filename);
    assert.equal((await manager.getSources())[0].name, 'Library');
    assert.equal((await manager.getFileContent('report-id')).summary, 'Report summary');
    assert.equal((await manager.getVirtualPlacements(source.id))[0].virtual_path, '/Reports/report.txt');
    const backup = path.join(`${filename}.backups`, fs.readdirSync(`${filename}.backups`)[0]);
    const original = new Database(backup, { readonly: true });
    try {
      assert.deepEqual(versions(original), [1, 2, 3, 4, 5]);
      assert.equal(original.prepare('SELECT summary FROM file_content').pluck().get(), 'Report summary');
      assert.equal(original.pragma('quick_check', { simple: true }), 'ok');
    } finally { original.close(); }
  } finally {
    await manager?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
