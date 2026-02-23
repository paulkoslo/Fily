const assert = require('node:assert/strict');
const test = require('node:test');

const {
  withTempDb,
  createSource,
  insertIndexedFile,
  canUseDatabaseIntegration,
} = require('./test-helpers');

/**
 * Integration tests for DatabaseManager.smartSearchFiles()
 *
 * Why integration tests here:
 * - smartSearch combines SQL filtering + JavaScript ranking.
 * - unit tests alone would miss SQL join/filter behavior.
 * - we can validate real behavior without any AI API call.
 */

// If native sqlite module cannot load (local Node ABI mismatch), skip these tests.
// In CI (clean install), these should run normally.
const integrationSkipReason = canUseDatabaseIntegration()
  ? false
  : 'Skipping DB integration tests: better-sqlite3 native module is unavailable for current Node runtime.';

test(
  'smart search ranks filename matches above summary and tags',
  { skip: integrationSkipReason },
  async () => {
    await withTempDb(async (db) => {
      const source = await createSource(db, 'rank-source');

      // File A: filename contains "budget" -> should rank highest.
      await insertIndexedFile(db, {
        sourceId: source.id,
        fileId: 'file-name-match',
        name: 'budget-plan.pdf',
        summary: 'planning notes',
        tags: ['work'],
        virtualPath: '/Finance/budget-plan.pdf',
      });

      // File B: summary contains "budget" -> should rank second.
      await insertIndexedFile(db, {
        sourceId: source.id,
        fileId: 'file-summary-match',
        name: 'meeting-notes.txt',
        summary: 'Budget budget review for Q1',
        tags: ['notes'],
      });

      // File C: only tags contain "budget" -> should rank third.
      await insertIndexedFile(db, {
        sourceId: source.id,
        fileId: 'file-tags-match',
        name: 'reference.txt',
        summary: 'general reference',
        tags: ['budget', 'finance'],
      });

      const results = await db.smartSearchFiles('budget', source.id, 10);

      assert.equal(results.length, 3);

      assert.equal(results[0].file_id, 'file-name-match');
      assert.equal(results[0].match_type, 'filename');
      assert.equal(results[0].virtual_path, '/Finance/budget-plan.pdf');

      assert.equal(results[1].file_id, 'file-summary-match');
      assert.equal(results[1].match_type, 'summary');

      assert.equal(results[2].file_id, 'file-tags-match');
      assert.equal(results[2].match_type, 'tags');
      assert.ok(Array.isArray(results[2].tags));
      assert.ok(results[2].tags.includes('budget'));
    }, 'fily-smart-search-rank-');
  }
);

test(
  'smart search respects source filtering',
  { skip: integrationSkipReason },
  async () => {
    await withTempDb(async (db) => {
      const sourceA = await createSource(db, 'source-a');
      const sourceB = await createSource(db, 'source-b');

      await insertIndexedFile(db, {
        sourceId: sourceA.id,
        fileId: 'invoice-a',
        name: 'invoice-a.pdf',
        summary: 'April invoice',
        tags: ['invoice'],
      });

      await insertIndexedFile(db, {
        sourceId: sourceB.id,
        fileId: 'invoice-b',
        name: 'invoice-b.pdf',
        summary: 'May invoice',
        tags: ['invoice'],
      });

      // No source filter: should see results from both sources.
      const allResults = await db.smartSearchFiles('invoice', undefined, 20);
      const allIds = new Set(allResults.map((r) => r.file_id));
      assert.ok(allIds.has('invoice-a'));
      assert.ok(allIds.has('invoice-b'));

      // Source filter: should only return source A results.
      const sourceAResults = await db.smartSearchFiles('invoice', sourceA.id, 20);
      assert.ok(sourceAResults.length >= 1);
      assert.ok(sourceAResults.every((r) => r.source_id === sourceA.id));
      assert.ok(sourceAResults.some((r) => r.file_id === 'invoice-a'));
      assert.ok(!sourceAResults.some((r) => r.file_id === 'invoice-b'));
    }, 'fily-smart-search-source-filter-');
  }
);

test(
  'smart search trims and lowercases query, and handles regex-like input safely',
  { skip: integrationSkipReason },
  async () => {
    await withTempDb(async (db) => {
      const source = await createSource(db, 'special-query');

      await insertIndexedFile(db, {
        sourceId: source.id,
        fileId: 'summary-special',
        name: 'notes.txt',
        summary: 'Budget(2026) planning session',
        tags: ['planning'],
      });

      // Query has spaces and uppercase; search should still match.
      const results = await db.smartSearchFiles('   BUDGET(2026)   ', source.id, 10);

      assert.equal(results.length, 1);
      assert.equal(results[0].file_id, 'summary-special');
      assert.equal(results[0].match_type, 'summary');
    }, 'fily-smart-search-special-query-');
  }
);

test(
  'smart search excludes files marked as missing and respects limit',
  { skip: integrationSkipReason },
  async () => {
    await withTempDb(async (db) => {
      const source = await createSource(db, 'missing-and-limit');

      // Insert 3 matching files.
      await insertIndexedFile(db, {
        sourceId: source.id,
        fileId: 'invoice-1',
        name: 'invoice-1.pdf',
        summary: 'invoice data',
        tags: ['invoice'],
        mtime: 10,
      });
      await insertIndexedFile(db, {
        sourceId: source.id,
        fileId: 'invoice-2',
        name: 'invoice-2.pdf',
        summary: 'invoice data',
        tags: ['invoice'],
        mtime: 20,
      });
      await insertIndexedFile(db, {
        sourceId: source.id,
        fileId: 'invoice-3',
        name: 'invoice-3.pdf',
        summary: 'invoice data',
        tags: ['invoice'],
        mtime: 30,
      });

      // Mark one file as missing: search should ignore it.
      await db.markFileMissing('invoice-2');

      // Limit to 2 results.
      const results = await db.smartSearchFiles('invoice', source.id, 2);

      assert.equal(results.length, 2);
      assert.ok(!results.some((r) => r.file_id === 'invoice-2'));
    }, 'fily-smart-search-missing-limit-');
  }
);

test(
  'smart search returns empty array for blank query',
  { skip: integrationSkipReason },
  async () => {
    await withTempDb(async (db) => {
      const source = await createSource(db, 'blank-query');

      await insertIndexedFile(db, {
        sourceId: source.id,
        fileId: 'some-file',
        name: 'some-file.txt',
        summary: 'hello world',
        tags: ['misc'],
      });

      const results = await db.smartSearchFiles('   ', source.id, 10);
      assert.deepEqual(results, []);
    }, 'fily-smart-search-blank-query-');
  }
);
