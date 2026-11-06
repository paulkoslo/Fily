const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { guardIpc, isTrustedRendererUrl } = require('../dist/main/security');
const { SourceSelectionGrants, resolveIndexedFile, resolveSourceFolder } = require('../dist/main/source-access');
const { withTempDb } = require('../../../packages/core/tests/test-helpers');

test('IPC runs only for the configured window, top frame and exact renderer URL', async () => {
  const frame = { url: 'http://localhost:5180/' };
  const contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents };
  let handler;
  let calls = 0;
  guardIpc({ handle(_channel, listener) { handler = listener; } }, () => window, frame.url)
    .handle('test', () => { calls++; return { success: true }; });
  assert.equal((await handler({ sender: contents, senderFrame: frame })).success, true);
  const attempts = [
    { sender: {}, senderFrame: frame },
    { sender: contents, senderFrame: { url: frame.url } },
    { sender: contents, senderFrame: null },
  ];
  for (const event of attempts) assert.equal((await handler(event)).success, false);
  frame.url = 'http://localhost:5180/untrusted.html';
  assert.equal((await handler({ sender: contents, senderFrame: frame })).success, false);
  frame.url = 'https://attacker.example/';
  assert.equal((await handler({ sender: contents, senderFrame: frame })).success, false);
  window.isDestroyed = () => true;
  assert.equal((await handler({ sender: contents, senderFrame: frame })).success, false);
  assert.equal(calls, 1);
});

test('renderer URLs reject spoofed origins and sibling files while allowing local hashes', () => {
  const expected = 'file:///Applications/Fily/ui/index.html';
  assert.equal(isTrustedRendererUrl(`${expected}#folder`, expected), true);
  for (const url of [
    'file:///Applications/Fily/ui/other.html',
    'https://localhost:5180/', 'http://localhost:5180.evil.example/',
    'http://localhost:5181/', 'http://user:pass@localhost:5180/', 'invalid',
  ]) assert.equal(isTrustedRendererUrl(url, 'http://localhost:5180/'), false);
});

test('indexed opens require a live source and reject traversal, symlink escapes and stale IDs', async () => {
  await withTempDb(async (db, { tempDir }) => {
    const library = path.join(tempDir, 'library');
    fs.mkdirSync(library);
    const source = await db.addSource('Library', library);
    const inside = path.join(library, 'inside.txt');
    fs.writeFileSync(inside, 'Inside');
    fs.writeFileSync(path.join(tempDir, 'outside.txt'), 'Outside');
    await db.upsertFile('inside', inside, 'inside.txt', 'txt', 6, 1, source.id);
    assert.equal(await resolveIndexedFile(db, 'inside'), fs.realpathSync(inside));
    assert.equal(await resolveSourceFolder(db, source.id), fs.realpathSync(library));
    await assert.rejects(resolveIndexedFile(db, 'unknown'));
    await assert.rejects(resolveSourceFolder(db, source.id, '..'), /outside/);
    await assert.rejects(resolveSourceFolder(db, source.id, tempDir), /outside/);
    fs.symlinkSync(path.join(tempDir, 'outside.txt'), path.join(library, 'escape.txt'));
    await db.upsertFile('escape', path.join(library, 'escape.txt'), 'escape.txt', 'txt', 7, 1, source.id);
    await assert.rejects(resolveIndexedFile(db, 'escape'), /outside/);
    fs.symlinkSync(tempDir, path.join(library, 'escape-folder'), 'dir');
    await assert.rejects(resolveSourceFolder(db, source.id, 'escape-folder'), /outside/);
    await db.markFileMissing('inside');
    await assert.rejects(resolveIndexedFile(db, 'inside'), /no longer indexed/);
    await db.removeSource(source.id);
    await assert.rejects(resolveSourceFolder(db, source.id), /no longer enabled/);
  });
});

test('source additions require a native-selection grant that is single use and expires', async () => {
  await withTempDb(async (_db, { tempDir }) => {
    const grants = new SourceSelectionGrants();
    assert.throws(() => grants.consume(tempDir), /folder picker/);
    const selected = grants.grant(tempDir);
    assert.equal(grants.consume(tempDir), selected);
    assert.throws(() => grants.consume(tempDir), /folder picker/);
    grants.grant(tempDir);
    const now = Date.now;
    try {
      Date.now = () => now() + 6 * 60 * 1000;
      assert.throws(() => grants.consume(tempDir), /folder picker/);
    } finally { Date.now = now; }
  });
});
