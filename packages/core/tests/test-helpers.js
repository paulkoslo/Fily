const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Load DatabaseManager lazily.
 *
 * Why lazy loading:
 * - DatabaseManager depends on native better-sqlite3.
 * - On some local environments, native module may not match Node ABI.
 * - Lazy load lets tests decide to skip integration cases gracefully.
 */
function loadDatabaseManager() {
  const { DatabaseManager } = require('../dist/db');
  return DatabaseManager;
}

/**
 * Check if DB integration tests can run in this environment.
 * Returns false when native better-sqlite3 cannot be loaded.
 */
function canUseDatabaseIntegration() {
  let tempDir = null;
  try {
    const DatabaseManager = loadDatabaseManager();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fily-db-check-'));
    const dbPath = path.join(tempDir, 'check.db');
    const db = new DatabaseManager(dbPath);
    // close() is async in type signature; we only need best-effort cleanup here.
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    return true;
  } catch {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    return false;
  }
}

/**
 * Create a fresh temporary SQLite database for one test case.
 *
 * Why this exists:
 * - Integration tests should not share state.
 * - Each test gets an isolated DB file, then we clean it up.
 */
function createTempDbContext(prefix = 'fily-test-') {
  const DatabaseManager = loadDatabaseManager();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, 'test.db');
  const db = new DatabaseManager(dbPath);

  return { db, dbPath, tempDir };
}

/**
 * Ensure DB connection is closed and temp files are removed.
 */
async function destroyTempDbContext(context) {
  if (!context) return;
  await context.db.close();
  fs.rmSync(context.tempDir, { recursive: true, force: true });
}

/**
 * Convenience wrapper used by tests:
 * - creates temp DB
 * - runs test logic
 * - always cleans up (even on assertion failure)
 */
async function withTempDb(run, prefix) {
  const context = createTempDbContext(prefix);
  try {
    return await run(context.db, context);
  } finally {
    await destroyTempDbContext(context);
  }
}

/**
 * Add a source row with a unique path.
 * Files don't need to physically exist on disk for DB-level tests.
 */
async function createSource(db, name) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourcePath = `/tmp/fily-test-source/${name}-${unique}`;
  return db.addSource(name, sourcePath);
}

/**
 * Insert one indexed file plus optional content and virtual placement.
 *
 * This mirrors the real pipeline shape:
 * files -> file_content -> virtual_placements
 */
async function insertIndexedFile(
  db,
  {
    sourceId,
    fileId,
    name,
    extension = '',
    relativePath = null,
    summary = null,
    tags = null,
    virtualPath = null,
    mtime = Date.now(),
    size = 100,
  }
) {
  const source = await db.getSourceById(sourceId);
  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  const ext =
    extension || (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
  const normalizedRelativePath = relativePath || name;
  const filePath = path.join(source.path, normalizedRelativePath);
  const parentPath = normalizedRelativePath.includes('/')
    ? normalizedRelativePath.split('/').slice(0, -1).join('/')
    : null;

  await db.upsertFile(
    fileId,
    filePath,
    name,
    ext,
    size,
    mtime,
    sourceId,
    normalizedRelativePath,
    parentPath
  );

  await db.upsertFileContent(
    fileId,
    'text',
    null,
    summary,
    [],
    null,
    'test-extractor',
    null,
    tags
  );

  if (virtualPath) {
    await db.upsertVirtualPlacementBatch(
      [
        {
          file_id: fileId,
          virtual_path: virtualPath,
          tags: tags || [],
          confidence: 0.9,
          reason: 'test placement',
        },
      ],
      'test-planner'
    );
  }
}

module.exports = {
  withTempDb,
  createSource,
  insertIndexedFile,
  canUseDatabaseIntegration,
};
