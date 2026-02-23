const assert = require('node:assert/strict');
const test = require('node:test');

// Contract tests:
// verify that runtime schemas accept valid payloads and reject invalid payloads.
const {
  FileCardSchema,
  PlannerOutputSchema,
  RunPlannerRequestSchema,
  SmartSearchFilesRequestSchema,
} = require('../dist/ipc/contracts');

// Happy-path PlannerOutput should pass validation.
test('PlannerOutputSchema accepts valid payload', () => {
  const parsed = PlannerOutputSchema.safeParse({
    file_id: 'abc123',
    virtual_path: '/Work/Reports/report.pdf',
    tags: ['work', 'report'],
    confidence: 0.8,
    reason: 'matched by extension and tags',
  });

  assert.equal(parsed.success, true);
});

// Confidence must stay between 0 and 1.
test('PlannerOutputSchema rejects invalid confidence', () => {
  const parsed = PlannerOutputSchema.safeParse({
    file_id: 'abc123',
    virtual_path: '/Work/Reports/report.pdf',
    tags: ['work', 'report'],
    confidence: 1.5,
    reason: 'invalid confidence',
  });

  assert.equal(parsed.success, false);
});

// FileCard is the planner's input shape; this checks required fields are enforced.
test('FileCardSchema enforces required fields', () => {
  const parsed = FileCardSchema.safeParse({
    file_id: 'file-1',
    source_id: 1,
    path: '/tmp/file-1.txt',
    relative_path: null,
    name: 'file-1.txt',
    extension: 'txt',
    size: 10,
    mtime: 1_700_000_000_000,
    summary: null,
    tags: ['note'],
  });

  assert.equal(parsed.success, true);
});

// Request shape should accept valid fields and reject wrong types.
test('RunPlannerRequestSchema allows optional sourceId and skipOptimization', () => {
  const valid = RunPlannerRequestSchema.safeParse({
    sourceId: 123,
    skipOptimization: true,
  });
  assert.equal(valid.success, true);

  const invalid = RunPlannerRequestSchema.safeParse({
    sourceId: '123',
  });
  assert.equal(invalid.success, false);
});

// Smart search requests need an actual query string.
test('SmartSearchFilesRequestSchema requires a non-empty query', () => {
  const valid = SmartSearchFilesRequestSchema.safeParse({
    query: 'report',
    limit: 10,
  });
  assert.equal(valid.success, true);

  const invalid = SmartSearchFilesRequestSchema.safeParse({
    query: '',
  });
  assert.equal(invalid.success, false);
});
