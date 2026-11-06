const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withTempDb, insertIndexedFile } = require('./test-helpers');
const { resolveSourcePath } = require('../dist/files');
const { WatcherManager } = require('../dist/indexer/watcher-manager');
const { ContentService } = require('../dist/extractors/content-service');
const { OpenFileRequestSchema } = require('../dist/ipc/contracts');

test('file-open requests accept identifiers and reject arbitrary renderer paths', () => {
  assert.equal(OpenFileRequestSchema.safeParse({ fileId: 'known' }).success, true);
  assert.equal(OpenFileRequestSchema.safeParse({ path: '/arbitrary/file' }).success, false);
  assert.equal(OpenFileRequestSchema.safeParse({ fileId: 'known', path: '/other/file' }).success, false);
});

test('source queries treat SQL wildcard characters in source paths literally', async () => {
  await withTempDb(async (db, { tempDir }) => {
    const source = await db.addSource('Literal', path.join(tempDir, 'a_%!b'));
    const other = await db.addSource('Sibling', path.join(tempDir, 'a_other!b'));
    const differentCase = await db.addSource('Different case', path.join(tempDir, 'A_%!B'));
    for (const [id, src] of [['inside', source], ['outside', other], ['different-case', differentCase]]) {
      await insertIndexedFile(db, { sourceId: src.id, fileId: id, name: `${id}.txt`, virtualPath: `/Files/${id}.txt` });
    }
    assert.equal(await db.getFileCount(source.id), 1);
    assert.deepEqual((await db.getVirtualPlacements(source.id)).map((p) => p.file_id), ['inside']);
    assert.deepEqual(await db.getTopLevelVirtualFolders(source.id), [{ path: '/Files', fileCount: 1 }]);
  });
});

test('watching and extraction refuse files that resolve outside a source', async () => {
  await withTempDb(async (db, { tempDir }) => {
    const library = path.join(tempDir, 'library');
    fs.mkdirSync(library);
    const source = await db.addSource('Library', library);
    const outside = path.join(tempDir, 'outside.txt');
    const link = path.join(library, 'link.txt');
    fs.writeFileSync(outside, 'Must not be read or uploaded');
    fs.symlinkSync(outside, link);
    assert.throws(() => resolveSourcePath(library, outside), /outside/);
    assert.throws(() => resolveSourcePath(library, link), /outside/);
    const watcher = new WatcherManager(db);
    await watcher.handleFileAddedOrChanged(link, source.id);
    assert.equal(await db.getFileCount(source.id), 0);

    // Simulate an old indexed path replaced by a symlink after scanning.
    await db.upsertFile('old-path', link, 'link.txt', 'txt', 10, 1, source.id);
    const [file] = await db.getFilesBySource(source.id);
    const service = new ContentService(db);
    let reads = 0;
    service.extractorManager = { extract() { reads++; throw new Error('Unexpected file read'); } };
    const result = await service.extractContent([file]);
    assert.equal(reads, 0);
    assert.equal(result.errors, 1);
    assert.equal(result.filesProcessed, 0);
    assert.match((await db.getFileContent(file.file_id)).error_message, /outside/);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'Must not be read or uploaded');
  });
});
