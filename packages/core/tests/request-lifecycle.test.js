const assert = require('node:assert/strict');
const test = require('node:test');
const { executeApiCall } = require('../dist/agents/api-call-helper');
const { LLMClient } = require('../dist/agents/llm-client');
const { WorkerPool } = require('../dist/agents/worker-pool');
const { withRequestDeadline } = require('../dist/agents/request-context');
const messages = [{ role: 'user', content: 'Synthetic document' }];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function hangingClient(onStart, onAbort) {
  return new LLMClient({ provider: 'openrouter', apiKey: 'synthetic-test-key', fetch: async (_url, options) =>
    new Promise((_, reject) => {
      const abort = () => { onAbort(); reject(options.signal.reason); };
      options.signal.addEventListener('abort', abort, { once: true });
      if (options.signal.aborted) abort();
      onStart();
    }) });
}

test('API deadlines abort the actual SDK HTTP transport, without hidden retries', async () => {
  let started = 0; let aborted = 0;
  const client = hangingClient(() => started++, () => aborted++);
  await assert.rejects(executeApiCall(messages, () => 'fallback', null, client, { timeoutMs: 30 }), /timeout/);
  await delay(5);
  assert.equal(started, 1); assert.equal(aborted, 1);
});

test('nested batch deadlines abort child API calls that have a longer budget', async () => {
  let aborted = 0;
  const client = hangingClient(() => {}, () => aborted++);
  await assert.rejects(withRequestDeadline(() => executeApiCall(messages, () => 'fallback', null, client, { timeoutMs: 10000 }), 30, 'Batch'), /Batch timeout/);
  await delay(5); assert.equal(aborted, 1);
});

test('pool shutdown reaches nested API calls and is never converted to fallback success', async () => {
  const pool = new WorkerPool(1); let start; let aborted = 0;
  const started = new Promise(resolve => { start = resolve; });
  const client = hangingClient(start, () => aborted++);
  const task = pool.execute(() => executeApiCall(messages, () => 'fallback', null, client));
  const rejected = assert.rejects(task, /shut down/);
  await started; pool.shutdown(); await rejected; await pool.waitForCompletion();
  assert.equal(aborted, 1);
});

test('time in the queue does not consume a request execution deadline', async () => {
  const pool = new WorkerPool(1);
  let release;
  const blocker = pool.execute(() => new Promise(resolve => { release = resolve; }));
  const request = executeApiCall(messages, () => 'fallback', pool, { chatCompletion: async () => 'result' }, { timeoutMs: 10 });
  await delay(40); release(); await blocker;
  assert.equal(await request, 'result'); await pool.waitForCompletion();
});

test('rate limited calls do not trigger automatic SDK retries', async () => {
  let count = 0;
  const client = new LLMClient({ provider: 'openrouter', apiKey: 'synthetic-test-key', fetch: async () => {
    count++;
    return new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429, headers: { 'content-type': 'application/json' } });
  } });
  assert.equal(await executeApiCall(messages, () => 'fallback', null, client), 'fallback');
  assert.equal(count, 1);
});

test('successful and failed API calls release their deadline timers', () => {
  const { spawnSync } = require('node:child_process');
  const modulePath = require.resolve('../dist/agents/api-call-helper');
  const child = spawnSync(process.execPath, ['-e', `
    const { executeApiCall } = require(${JSON.stringify(modulePath)});
    (async () => {
      await executeApiCall([], () => '', null, { chatCompletion: async () => 'done' });
      await executeApiCall([], () => '', null, { chatCompletion: async () => { throw new Error('failed'); } });
    })();
  `], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 3000, encoding: 'utf8' });
  assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
});

test('pre-aborted calls cannot become missing-client fallback successes', async () => {
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(executeApiCall(messages, () => 'fallback', null, null, { signal: controller.signal }), /cancelled/);
});

test('shutdown aborts the audio SDK transport and returns a structured extraction failure', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const OpenAI = require('openai').default;
  const { AudioExtractor } = require('../dist/extractors/audio-extractor');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fily-audio-lifecycle-'));
  const pool = new WorkerPool(1); let start; let aborted = 0;
  const started = new Promise(resolve => { start = resolve; });
  try {
    const filename = path.join(directory, 'synthetic.wav'); fs.writeFileSync(filename, 'synthetic-audio');
    const extractor = new AudioExtractor(pool);
    extractor.openai = new OpenAI({ apiKey: 'synthetic-test-key', fetch: async (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => { aborted++; reject(options.signal.reason); }, { once: true });
      start();
    }) });
    const operation = extractor.extract(filename, 'wav');
    await started; pool.shutdown();
    const result = await operation;
    assert.equal(result.success, false); assert.match(result.error, /shut down/);
    assert.equal(aborted, 1); await pool.waitForCompletion();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('optimizer batches can fill the pool without deadlocking on nested API slots', async () => {
  const { OptimizerAgent } = require('../dist/agents/optimizer-agent');
  const pool = new WorkerPool(2); const optimizer = new OptimizerAgent(pool);
  optimizer.batchSize = 1;
  let calls = 0; let active = 0; let peak = 0;
  optimizer.llmClient = { chatCompletion: async () => {
    calls++; peak = Math.max(peak, ++active);
    try { await delay(3); return JSON.stringify({ optimizations: [], newFolders: [] }); }
    finally { active--; }
  } };
  const files = Array.from({ length: 5 }, (_, i) => ({
    card: { file_id: `file-${i}`, source_id: 1, name: `${i}.txt`, extension: 'txt', relative_path: `${i}.txt`, tags: [], summary: 'Synthetic report' },
    currentPlacement: { file_id: `file-${i}`, virtual_path: `/Reports/${i}.txt`, confidence: .2, reason: 'Needs review', tags: [] },
  }));
  const deadline = setTimeout(() => pool.shutdown(), 2000);
  try {
    await optimizer.optimizePlacements({ folders: [], rules: [] }, files);
    assert.equal(calls, 5); assert.equal(peak, 2);
    await pool.waitForCompletion();
  } finally { clearTimeout(deadline); pool.shutdown(); }
});
