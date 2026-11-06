const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { WatcherManager } = require('../dist/indexer/watcher-manager');
const { Crawler, computeFileId } = require('../dist/indexer/crawler');
const { withTempDb, createSource, insertIndexedFile } = require('./test-helpers');

test('watcher replaces changed revisions and invalidates their analysis and placement', async () => {
  await withTempDb(async (db, { tempDir }) => {
    const sourcePath = path.join(tempDir, 'library');
    fs.mkdirSync(sourcePath);
    const source = await db.addSource('Library', sourcePath);
    const filePath = path.join(sourcePath, 'report.TXT');
    fs.writeFileSync(filePath, 'Original report');
    const stats = fs.statSync(filePath);
    const oldId = computeFileId(filePath, stats.size, stats.mtimeMs);
    await insertIndexedFile(db, {
      sourceId: source.id, fileId: oldId, name: 'report.TXT',
      size: stats.size, mtime: stats.mtimeMs, summary: 'Old analysis',
      tags: ['report'], virtualPath: '/Work/report.TXT',
    });

    const manager = new WatcherManager(db);
    fs.writeFileSync(filePath, 'A revised and longer report');
    // Feed the normalized event directly to avoid OS watcher timing in tests.
    await manager.handleEvent({ type: 'change', path: filePath, sourceId: source.id });
    const files = await db.getFilesBySource(source.id);
    assert.equal(files.length, 1);
    assert.notEqual(files[0].file_id, oldId);
    assert.equal(files[0].extension, 'txt');
    assert.equal(await db.getFileContent(oldId), null);
    assert.deepEqual(await db.getVirtualPlacements(source.id), []);
    assert.deepEqual(await db.getFilesNeedingContent(source.id), [files[0].file_id]);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'A revised and longer report');

    await manager.handleFileDeleted(filePath, source.id);
    assert.deepEqual(await db.getFilesBySource(source.id), []);
    await manager.handleFileAddedOrChanged(filePath, source.id);
    assert.equal((await db.getFilesBySource(source.id)).length, 1);
  });
});

test('unchanged revisions preserve analysis and ownership across overlapping sources', async () => {
  await withTempDb(async (db, { tempDir }) => {
    const parent = await db.addSource('Parent', tempDir);
    const childPath = path.join(tempDir, 'child');
    fs.mkdirSync(childPath);
    const child = await db.addSource('Child', childPath, parent.id);
    const filePath = path.join(childPath, 'note.txt');
    fs.writeFileSync(filePath, 'First revision');
    const stats = fs.statSync(filePath);
    const fileId = computeFileId(filePath, stats.size, stats.mtimeMs);
    await insertIndexedFile(db, {
      sourceId: parent.id, fileId, name: 'note.txt', relativePath: 'child/note.txt',
      size: stats.size, mtime: stats.mtimeMs, summary: 'Keep this analysis',
      virtualPath: '/Notes/note.txt',
    });

    const manager = new WatcherManager(db);
    await manager.handleFileAddedOrChanged(filePath, child.id);
    assert.equal((await db.getFileContent(fileId)).summary, 'Keep this analysis');
    assert.equal((await db.getVirtualPlacements(parent.id)).length, 1);

    fs.writeFileSync(filePath, 'Second revision with new content');
    await manager.handleFileAddedOrChanged(filePath, child.id);
    const files = await db.getFilesBySource(parent.id);
    assert.equal(files.length, 1);
    assert.equal(files[0].source_id, parent.id);
    assert.equal(files[0].relative_path, 'child/note.txt');
    assert.equal((await db.getFilesBySource(child.id))[0].file_id, files[0].file_id);
    assert.equal(await db.getFileContent(fileId), null);
  });
});

test('revision replacement rolls back when the new record cannot be inserted', async () => {
  await withTempDb(async (db) => {
    const source = await createSource(db, 'rollback');
    await insertIndexedFile(db, {
      sourceId: source.id, fileId: 'before', name: 'note.txt',
      summary: 'Preserved on failure', virtualPath: '/Notes/note.txt',
    });
    const filePath = path.join(source.path, 'note.txt');
    await assert.rejects(db.upsertFile('after', filePath, null, 'txt', 200, 2, source.id));
    assert.equal((await db.getFilesBySource(source.id))[0].file_id, 'before');
    assert.equal((await db.getFileContent('before')).summary, 'Preserved on failure');
    assert.equal((await db.getVirtualPlacements(source.id)).length, 1);
  });
});

test('large cleanup visits every row while deleting and leaves other sources alone', async () => {
  await withTempDb(async (db) => {
    const source = await createSource(db, 'cleanup');
    const other = await createSource(db, 'untouched');
    const files = Array.from({ length: 20000 }, (_, i) => ({
      fileId: `cleanup-${i}`, filePath: path.join(source.path, `${i}.txt`),
      name: `${i}.txt`, extension: 'txt', size: 1, mtime: 1,
      sourceId: source.id, relativePath: `${i}.txt`, parentPath: null,
    }));
    await db.upsertFileBatch(files);
    await insertIndexedFile(db, {
      sourceId: other.id, fileId: 'other', name: 'other.txt', summary: 'Keep',
    });
    await db.upsertFileContent('cleanup-0', 'text', 'text', 'stale', [], null, 'test', null, []);
    await db.upsertVirtualPlacementBatch([{
      file_id: 'cleanup-0', virtual_path: '/Old/0.txt', tags: [], confidence: 0.9, reason: 'old',
    }], 'test');

    const keep = new Set(files.slice(19000).map((file) => file.fileId));
    assert.equal(await db.deleteFilesNotInSetOptimized(source.id, keep), 19000);
    assert.equal(await db.getFileCount(source.id), 1000);
    assert.equal(await db.getFileCount(other.id), 1);
    assert.equal(await db.getFileContent('cleanup-0'), null);
    assert.deepEqual(await db.getVirtualPlacements(source.id), []);
    assert.equal(await db.deleteFilesNotInSetOptimized(source.id, keep), 0);
    assert.equal(await db.deleteFilesNotInSetOptimized(source.id, new Set()), 1000);
    assert.equal(await db.getFileCount(other.id), 1);
  });
});

test('rescanning a previously missing file makes it visible again', async () => {
  await withTempDb(async (db, { tempDir }) => {
    const sourcePath = path.join(tempDir, 'library');
    fs.mkdirSync(sourcePath);
    const source = await db.addSource('Library', sourcePath);
    const filePath = path.join(sourcePath, 'note.txt');
    fs.writeFileSync(filePath, 'Note');
    const crawler = new Crawler(db);
    await crawler.scan(source.id, sourcePath);
    const [file] = await db.getFilesBySource(source.id);
    await db.markFileMissing(file.file_id);
    assert.equal(await db.getFileCount(source.id), 0);
    const result = await crawler.scan(source.id, sourcePath);
    assert.deepEqual(result.errors, []);
    assert.equal((await db.getFilesBySource(source.id))[0].file_id, file.file_id);
  });
});

test('an incomplete scan preserves records and analysis under unreadable folders', async () => {
  await withTempDb(async (db, { tempDir }) => {
    const sourcePath = path.join(tempDir, 'library');
    const blockedPath = path.join(sourcePath, 'blocked');
    fs.mkdirSync(blockedPath, { recursive: true });
    fs.writeFileSync(path.join(blockedPath, 'retained.txt'), 'Keep');
    const source = await db.addSource('Library', sourcePath);
    await insertIndexedFile(db, {
      sourceId: source.id, fileId: 'retained', name: 'retained.txt',
      relativePath: 'blocked/retained.txt', summary: 'Previously analyzed',
      virtualPath: '/Notes/retained.txt',
    });
    fs.writeFileSync(path.join(sourcePath, 'new.txt'), 'New');
    const readdir = fs.readdirSync;
    let result;
    try {
      fs.readdirSync = (dir, ...args) => {
        if (dir === blockedPath) throw new Error('EACCES: permission denied');
        return readdir(dir, ...args);
      };
      result = await new Crawler(db).scan(source.id, sourcePath);
    } finally {
      fs.readdirSync = readdir;
    }
    assert.ok(result.errors.some((error) => error.includes('EACCES')));
    assert.equal(result.filesRemoved, 0);
    assert.equal(result.foldersRemoved, 0);
    assert.equal(await db.getFileCount(source.id), 2);
    assert.equal((await db.getFileContent('retained')).summary, 'Previously analyzed');
    assert.equal((await db.getVirtualPlacements(source.id)).length, 1);
  });
});
