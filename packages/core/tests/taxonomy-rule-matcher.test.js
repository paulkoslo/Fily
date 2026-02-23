const assert = require('node:assert/strict');
const test = require('node:test');

// Rule-matcher tests:
// verify deterministic "file -> rule -> folder" behavior.
const {
  calculateRuleSpecificity,
  computeRuleMatchCounts,
  findBestRule,
  getFileAssignments,
  ruleMatchesWithQuality,
} = require('../dist/planner/taxonomy-rule-matcher');

const NOW = 1_700_000_000_000;

// Build a realistic file card with optional overrides for each scenario.
function makeCard(fileId, overrides = {}) {
  return {
    file_id: fileId,
    source_id: 1,
    path: `/files/${fileId}.pdf`,
    relative_path: null,
    name: `${fileId}.pdf`,
    extension: 'pdf',
    size: 100,
    mtime: NOW,
    summary: 'Quarterly finance report',
    tags: ['work', 'finance'],
    ...overrides,
  };
}

// Build a default rule and override only the parts needed by each test case.
function makeRule(id, overrides = {}) {
  return {
    id,
    targetFolderId: 'folder-default',
    priority: 1,
    reasonTemplate: 'default reason',
    ...overrides,
  };
}

// Check matching behavior for full matches, failures, and empty rules.
test('ruleMatchesWithQuality evaluates conditions and quality correctly', () => {
  const card = makeCard('file-1', {
    path: '/Projects/Q1/finance-summary.pdf',
    relative_path: 'Projects/Q1/finance-summary.pdf',
  });

  const strongRule = makeRule('r-strong', {
    requiredTags: ['work'],
    forbiddenTags: ['personal'],
    pathContains: ['projects'],
    extensionIn: ['pdf'],
    summaryContainsAny: ['quarterly'],
  });

  const strongResult = ruleMatchesWithQuality(strongRule, card);
  assert.equal(strongResult.matches, true);
  assert.equal(strongResult.matchQuality, 1);

  const missingTagRule = makeRule('r-missing-tag', {
    requiredTags: ['missing'],
  });
  const missingTagResult = ruleMatchesWithQuality(missingTagRule, card);
  assert.equal(missingTagResult.matches, false);
  assert.equal(missingTagResult.matchQuality, 0);

  const emptyRule = makeRule('r-empty', {});
  const emptyResult = ruleMatchesWithQuality(emptyRule, card);
  assert.equal(emptyResult.matches, true);
  assert.equal(emptyResult.matchQuality, 0.5);
});

// Best rule should be selected by score (priority + specificity).
test('findBestRule picks highest priority + specificity score', () => {
  const card = makeCard('file-2', {
    path: '/Projects/Q1/report.pdf',
    relative_path: 'Projects/Q1/report.pdf',
  });

  const highPriorityRule = makeRule('r-high-priority', {
    targetFolderId: 'folder-priority',
    priority: 5,
    requiredTags: ['work'],
  });

  const highSpecificityRule = makeRule('r-high-specificity', {
    targetFolderId: 'folder-specific',
    priority: 1,
    requiredTags: ['work'],
    forbiddenTags: ['personal'],
    pathContains: ['projects'],
    extensionIn: ['pdf'],
    summaryContainsAny: ['quarterly'],
  });

  const match = findBestRule([highPriorityRule, highSpecificityRule], card);
  assert.ok(match);
  assert.equal(match.rule.id, 'r-high-specificity');
  assert.equal(calculateRuleSpecificity(highSpecificityRule), 1);
});

// End-to-end deterministic check: assignment + per-rule match counts.
test('getFileAssignments and computeRuleMatchCounts produce deterministic output', () => {
  const folders = [
    {
      id: 'folder-finance',
      path: '/Work/Finance',
      description: 'Finance documents',
    },
    {
      id: 'folder-notes',
      path: '/Work/Notes',
      description: 'Notes',
    },
  ];

  const rules = [
    makeRule('r-finance', {
      targetFolderId: 'folder-finance',
      requiredTags: ['finance'],
      extensionIn: ['pdf'],
      priority: 3,
    }),
    makeRule('r-notes', {
      targetFolderId: 'folder-notes',
      pathContains: ['notes'],
      extensionIn: ['txt'],
      priority: 2,
    }),
  ];

  const cards = [
    makeCard('finance-file', {
      extension: 'pdf',
      tags: ['finance', 'work'],
      path: '/files/finance-file.pdf',
    }),
    makeCard('notes-file', {
      extension: 'txt',
      tags: ['work'],
      path: '/files/team-notes.txt',
      summary: 'Meeting notes',
    }),
    makeCard('unmatched-file', {
      extension: 'png',
      tags: ['personal'],
      path: '/files/photo.png',
      summary: 'Photo',
    }),
  ];

  const assignments = getFileAssignments(rules, folders, cards);
  assert.equal(assignments.size, 2);
  assert.deepEqual(assignments.get('finance-file'), {
    folderId: 'folder-finance',
    folderPath: '/Work/Finance',
  });
  assert.deepEqual(assignments.get('notes-file'), {
    folderId: 'folder-notes',
    folderPath: '/Work/Notes',
  });
  assert.equal(assignments.has('unmatched-file'), false);

  const counts = computeRuleMatchCounts(rules, cards);
  assert.equal(counts.get('r-finance'), 1);
  assert.equal(counts.get('r-notes'), 1);
});
