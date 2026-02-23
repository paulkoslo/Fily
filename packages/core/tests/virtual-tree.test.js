const assert = require('node:assert/strict');
const test = require('node:test');

// Virtual tree tests:
// verify virtual folders/files are built, sorted, and counted correctly.
const { VirtualTreeBuilder } = require('../dist/virtual-tree');

const NOW = 1_700_000_000_000;

// Helper to generate consistent FileRecord fixtures.
function makeFileRecord(id, fileId, name, path, sourceId = 1) {
  const extension = name.includes('.') ? name.split('.').pop() ?? '' : '';
  return {
    id,
    file_id: fileId,
    path,
    name,
    extension,
    size: 123,
    mtime: NOW,
    source_id: sourceId,
    relative_path: null,
    parent_path: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

// Some tree paths intentionally include missing file records.
// Those branches log warnings, which are expected for these tests.
function withMutedConsoleWarn(fn) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = originalWarn;
  }
}

// Full build path: planner outputs -> nested tree + stats.
test('build creates sorted tree and computes file counts', () => {
  const builder = new VirtualTreeBuilder();
  const records = [
    makeFileRecord(1, 'f1', 'b.txt', '/tmp/b.txt'),
    makeFileRecord(2, 'f2', 'a.txt', '/tmp/a.txt'),
    makeFileRecord(3, 'f3', 'notes.md', '/tmp/notes.md'),
  ];
  const fileRecordsMap = new Map(records.map((record) => [record.file_id, record]));

  const outputs = [
    {
      file_id: 'f1',
      virtual_path: '/Work/Reports/b.txt',
      tags: ['work'],
      confidence: 0.8,
      reason: 'report',
    },
    {
      file_id: 'f2',
      virtual_path: '/Work/Reports/a.txt',
      tags: ['work'],
      confidence: 0.9,
      reason: 'report',
    },
    {
      file_id: 'f3',
      virtual_path: '/Personal/notes.md',
      tags: ['personal'],
      confidence: 0.9,
      reason: 'note',
    },
    {
      file_id: 'missing',
      virtual_path: '/Other/missing.txt',
      tags: [],
      confidence: 0.1,
      reason: 'missing record',
    },
  ];

  const root = withMutedConsoleWarn(() => builder.build(outputs, fileRecordsMap));

  assert.equal(root.fileCount, 3);
  assert.deepEqual(
    root.children.map((child) => child.name),
    ['Personal', 'Work']
  );

  const reports = builder.getNodeByPath(root, '/Work/Reports');
  assert.ok(reports);
  assert.equal(reports.type, 'folder');
  assert.equal(reports.fileCount, 2);
  assert.deepEqual(
    reports.children.map((child) => child.name),
    ['a.txt', 'b.txt']
  );

  const flattened = builder.flatten(root);
  assert.equal(flattened.length, 3);

  const stats = builder.getStats(root);
  assert.equal(stats.totalFolders, 4);
  assert.equal(stats.totalFiles, 3);
});

// Fast top-level-only build used for lazy-loading scenarios.
test('buildTopLevelOnly builds only first level with counts', () => {
  const builder = new VirtualTreeBuilder();
  const placements = [
    {
      id: 1,
      file_id: 'f1',
      virtual_path: '/Work/Reports/a.txt',
      tags: '["work"]',
      confidence: 0.8,
      reason: 'report',
      planner_version: '0.1.0',
      created_at: NOW,
    },
    {
      id: 2,
      file_id: 'f2',
      virtual_path: '/Work/Notes/b.txt',
      tags: '["work"]',
      confidence: 0.8,
      reason: 'note',
      planner_version: '0.1.0',
      created_at: NOW,
    },
    {
      id: 3,
      file_id: 'f3',
      virtual_path: '/Personal/c.txt',
      tags: '["personal"]',
      confidence: 0.8,
      reason: 'personal',
      planner_version: '0.1.0',
      created_at: NOW,
    },
  ];

  const root = builder.buildTopLevelOnly(placements, 3);

  assert.equal(root.fileCount, 3);
  assert.deepEqual(
    root.children.map((child) => child.name),
    ['Personal', 'Work']
  );

  const work = builder.getNodeByPath(root, '/Work');
  assert.ok(work);
  assert.equal(work.type, 'folder');
  assert.equal(work.fileCount, 2);
  assert.equal(work.children.length, 0);
});

// Build from DB placement rows, including JSON tag parsing.
test('buildFromPlacements parses tags and skips missing file records', () => {
  const builder = new VirtualTreeBuilder();
  const records = [makeFileRecord(1, 'f1', 'one.md', '/tmp/one.md')];
  const fileRecordsMap = new Map(records.map((record) => [record.file_id, record]));

  const placements = [
    {
      id: 1,
      file_id: 'f1',
      virtual_path: '/Misc/one.md',
      tags: '["misc"]',
      confidence: 0.7,
      reason: 'misc',
      planner_version: '0.1.0',
      created_at: NOW,
    },
    {
      id: 2,
      file_id: 'missing',
      virtual_path: '/Misc/missing.md',
      tags: '[]',
      confidence: 0.1,
      reason: 'missing',
      planner_version: '0.1.0',
      created_at: NOW,
    },
  ];

  const root = withMutedConsoleWarn(() => builder.buildFromPlacements(placements, fileRecordsMap));
  const files = builder.flatten(root);

  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'one.md');
  assert.deepEqual(files[0].placement.tags, ['misc']);
});
