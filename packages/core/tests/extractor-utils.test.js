const assert = require('node:assert/strict');
const test = require('node:test');

const {
  truncateMetadata,
  truncateToWordLimit,
  withTimeout,
} = require('../dist/extractors/extractor-utils');

test('truncateToWordLimit keeps short text unchanged', () => {
  const text = 'one two three';
  assert.equal(truncateToWordLimit(text, 10), text);
});

test('truncateToWordLimit truncates long text and appends marker', () => {
  const text = Array.from({ length: 12 }, (_, i) => `word${i + 1}`).join(' ');
  const truncated = truncateToWordLimit(text, 5);

  assert.match(truncated, /word1 word2 word3 word4 word5/);
  assert.match(truncated, /\[\.\.\. content truncated to 1000 words \.\.\.\]/);
});

test('truncateMetadata limits oversized metadata and preserves core fields', () => {
  const metadata = {
    extension: 'pdf',
    fileName: 'very-long-file-name.pdf',
    filePath: '/tmp/very-long-file-name.pdf',
    mimeType: 'application/pdf',
    largeText: 'x'.repeat(2000),
    nested: {
      deep: 'ignored',
    },
  };

  const result = truncateMetadata(metadata, 300);
  assert.ok(result);
  assert.equal(result.extension, 'pdf');
  assert.equal(result.fileName, 'very-long-file-name.pdf');
  assert.equal(typeof result.largeText, 'string');
  assert.ok(JSON.stringify(result).length <= 300);
});

test('truncateMetadata returns minimal object when serialization throws', () => {
  const circular = {
    extension: 'txt',
    fileName: 'bad.txt',
  };
  circular.self = circular;

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = truncateMetadata(circular, 100);
    assert.deepEqual(result, {
      extension: 'txt',
      fileName: 'bad.txt',
    });
  } finally {
    console.warn = originalWarn;
  }
});

test('withTimeout resolves when promise completes before timeout', async () => {
  const result = await withTimeout(
    new Promise((resolve) => {
      setTimeout(() => resolve('ok'), 5);
    }),
    25,
    10,
    '/tmp/file.txt'
  );

  assert.equal(result, 'ok');
});

test('withTimeout rejects when promise exceeds timeout', async () => {
  await assert.rejects(
    withTimeout(
      new Promise((resolve) => {
        setTimeout(() => resolve('late'), 30);
      }),
      10,
      50,
      '/tmp/file.txt'
    ),
    /Extraction timeout after 10ms/
  );
});
