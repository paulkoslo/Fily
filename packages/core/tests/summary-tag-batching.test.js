const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SummaryTagAgent } = require('../dist/agents/summary-tag-agent');
const { ExtractionOrchestrator } = require('../dist/agents/extraction-orchestrator');
const { WorkerPool } = require('../dist/agents/worker-pool');
const { loadImageForAnalysis } = require('../dist/agents/image-input');
const { BASE64_IMAGE_MAX_SIZE_BYTES } = require('../dist/planner/constants');
function file(i) { return { fileId: `file-${i}`, filePath: `/synthetic/${i}.txt`, fileName: `${i}.txt`, extension: 'txt', contentType: 'text', extractedText: 'Synthetic report' }; }

test('batch callbacks persist every result once, including invalid images, and preserve input order', async () => {
  const saved = []; let clientCalls = 0;
  const agent = new SummaryTagAgent(new WorkerPool(2), undefined, async (number, total, results) => {
    saved.push({ number, total, ids: results.map(r => r.fileId) });
  });
  agent.llmClient = { chatCompletion: async () => { clientCalls++; return '[]'; } };
  const files = Array.from({ length: 45 }, (_, i) => file(i));
  files.splice(3, 0, { ...file(99), contentType: 'image', imageBuffer: Buffer.from('invalid'), imageMimeType: 'image/tiff' });
  const results = await agent.processBatch(files);
  assert.deepEqual(results.map(r => r.fileId), files.map(f => f.fileId));
  assert.deepEqual(saved.flatMap(r => r.ids).sort(), files.map(f => f.fileId).sort());
  assert.deepEqual(saved.map(r => r.number).sort(), [1, 2, 3, 4]);
  assert.ok(saved.every(r => r.total === 4));
  assert.equal(clientCalls, 3);
});

test('a failed persistence callback rejects the operation instead of retrying it as inference fallback', async () => {
  let writes = 0;
  const agent = new SummaryTagAgent(new WorkerPool(1), undefined, async () => { writes++; throw new Error('disk full'); });
  agent.llmClient = null;
  await assert.rejects(agent.processBatch([file(1), file(2)]), /disk full/);
  assert.equal(writes, 1);
});

test('the extraction adapter defers image reads to active batches and releases payloads between batches', async () => {
  const pool = new WorkerPool(1);
  const orchestrator = new ExtractionOrchestrator(pool);
  let loaded = 0; let started; let release;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const blocker = new Promise(resolve => { release = resolve; });
  let calls = 0;
  orchestrator.summaryTagAgent.llmClient = { chatCompletion: async () => {
    if (++calls === 1) { started(); await blocker; }
    return '[]';
  } };
  const files = Array.from({ length: 25 }, (_, i) => ({
    ...file(i), extension: 'jpg', extractedContent: { contentType: 'image', extractedText: '', keywords: [], metadata: { mimeType: 'image/jpeg' } },
    loadImage: async signal => { signal.throwIfAborted(); loaded++; return Buffer.from('synthetic-jpeg'); },
  }));
  const operation = orchestrator.processBatch(files);
  await startedPromise;
  assert.equal(loaded, 5, 'only the first active vision batch may read images');
  assert.equal(pool.getStats().queued, 4);
  release();
  const results = await operation;
  assert.equal(loaded, 25); assert.equal(calls, 5);
  assert.deepEqual(results.map(r => r.fileId), files.map(f => f.fileId));
  assert.ok(files.every(f => f.imageBuffer === undefined));
  await pool.waitForCompletion();
});

test('pool cancellation cannot invoke a late persistence callback for an aborted batch', async () => {
  const pool = new WorkerPool(1); let start; let saved = 0;
  const started = new Promise(resolve => { start = resolve; });
  const agent = new SummaryTagAgent(pool, undefined, async () => { saved++; });
  agent.llmClient = { chatCompletion: async (_messages, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }); start();
  }) };
  const operation = agent.processBatch([file(1), file(2)]);
  const rejected = assert.rejects(operation, /shut down/);
  await started; pool.shutdown(); await rejected; await pool.waitForCompletion();
  assert.equal(saved, 0);
});

test('image reads reject oversized and cancelled inputs before loading their contents', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fily-image-input-'));
  try {
    const filename = path.join(directory, 'image.jpg');
    fs.writeFileSync(filename, Buffer.from('synthetic-image'));
    assert.equal((await loadImageForAnalysis(filename)).toString(), 'synthetic-image');
    const controller = new AbortController(); controller.abort(new Error('cancelled read'));
    await assert.rejects(loadImageForAnalysis(filename, controller.signal), /cancelled read/);
    fs.truncateSync(filename, Math.floor(BASE64_IMAGE_MAX_SIZE_BYTES / 4) * 3 + 1);
    await assert.rejects(loadImageForAnalysis(filename), /size limit/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
