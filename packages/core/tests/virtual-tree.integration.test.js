const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadVirtualTree } = require('../dist/virtual-tree');
const { withTempDb, createSource, insertIndexedFile } = require('./test-helpers');

test('nested-only categories stay visible across the 10,000-file lazy-load threshold', async () => {
  await withTempDb(async (db) => {
    const source = await createSource(db, 'large-tree');
    const files = Array.from({ length: 10000 }, (_, i) => ({
      fileId: `tree-${i}`, filePath: path.join(source.path, `${i}.pdf`),
      name: `${i}.pdf`, extension: 'pdf', size: 1, mtime: 1,
      sourceId: source.id, relativePath: `${i}.pdf`, parentPath: null,
    }));
    await db.upsertFileBatch(files);
    await db.upsertVirtualPlacementBatch(files.map((file, i) => ({
      file_id: file.fileId,
      virtual_path: `/${i % 2 ? 'Work/Invoices/2026' : 'Personal/Receipts'}/${file.name}`,
      tags: [], confidence: 0.9, reason: 'fixture',
    })), 'test');

    const full = await loadVirtualTree(db, source.id);
    assert.equal(full.fileCount, 10000);
    assert.deepEqual(full.children.map((node) => [node.name, node.fileCount]), [
      ['Personal', 5000], ['Work', 5000],
    ]);
    assert.ok(full.children.every((node) => node.children.length > 0));

    await insertIndexedFile(db, {
      sourceId: source.id, fileId: 'loose', name: 'loose.txt', virtualPath: '/loose.txt',
    });
    const lazy = await loadVirtualTree(db, source.id);
    assert.equal(lazy.fileCount, 10001);
    assert.deepEqual(lazy.children.map((node) => [node.name, node.fileCount]), [
      ['Personal', 5000], ['Work', 5000], ['loose.txt', undefined],
    ]);
    assert.ok(lazy.children.filter((node) => node.type === 'folder').every((node) => node.children.length === 0));
    assert.equal(lazy.children[2].fileRecord.file_id, 'loose');
    const workFolders = await db.getDirectVirtualFolderPaths('/Work', source.id);
    assert.deepEqual(workFolders, ['/Work/Invoices']);
  });
});

test('top-level aggregates honor source scope, nested sources, missing files and root files', async () => {
  await withTempDb(async (db) => {
    const parent = await createSource(db, 'parent-tree');
    const child = await db.addSource('Child', path.join(parent.path, 'child'), parent.id);
    const other = await createSource(db, 'other-tree');
    await insertIndexedFile(db, {
      sourceId: parent.id, fileId: 'nested', name: 'nested.pdf',
      relativePath: 'child/nested.pdf', virtualPath: '/Work/Invoices/nested.pdf',
    });
    await insertIndexedFile(db, {
      sourceId: parent.id, fileId: 'shallow', name: 'shallow.txt', virtualPath: '/Work/shallow.txt',
    });
    await insertIndexedFile(db, {
      sourceId: parent.id, fileId: 'root', name: 'root.txt', virtualPath: '/root.txt',
    });
    await insertIndexedFile(db, {
      sourceId: other.id, fileId: 'elsewhere', name: 'elsewhere.txt', virtualPath: '/Other/Deep/elsewhere.txt',
    });
    await insertIndexedFile(db, {
      sourceId: parent.id, fileId: 'missing', name: 'missing.txt', virtualPath: '/Missing/missing.txt',
    });
    await db.markFileMissing('missing');

    assert.deepEqual(await db.getTopLevelVirtualFolders(parent.id), [{ path: '/Work', fileCount: 2 }]);
    assert.deepEqual(await db.getTopLevelVirtualFolders(child.id), [{ path: '/Work', fileCount: 1 }]);
    assert.deepEqual(await db.getTopLevelVirtualFolders(), [
      { path: '/Other', fileCount: 1 }, { path: '/Work', fileCount: 2 },
    ]);
    assert.deepEqual(await db.getTopLevelVirtualFolders(99999), []);
    const empty = await loadVirtualTree(db, 99999);
    assert.equal(empty.fileCount, 0);
    assert.deepEqual(empty.children, []);
  });
});
