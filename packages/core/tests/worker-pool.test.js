const assert = require('node:assert/strict');
const test = require('node:test');
const { WorkerPool } = require('../dist/agents/worker-pool');
const { currentRequestSignal } = require('../dist/agents/request-context');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }

test('pool enforces concurrency, starts queued tasks in order and drains after failures', async () => {
  const pool = new WorkerPool(2);
  let active = 0; let peak = 0;
  const order = [];
  const tasks = Array.from({ length: 30 }, (_, i) => pool.execute(async signal => {
    assert.equal(currentRequestSignal(), signal);
    order.push(i); peak = Math.max(peak, ++active);
    try { await delay(2); if (i === 4) throw new Error('synthetic failure'); return i; }
    finally { active--; }
  }));
  const results = await Promise.allSettled(tasks);
  await pool.waitForCompletion();
  assert.equal(peak, 2);
  assert.deepEqual(order, Array.from({ length: 30 }, (_, i) => i));
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.deepEqual(pool.getStats(), { active: 0, queued: 0, max: 2 });
});

test('shutdown settles queued promises, signals active work and refuses new submissions', async () => {
  const pool = new WorkerPool(1);
  const started = gate();
  const first = pool.execute(signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    started.release();
  }));
  let queuedRan = false;
  const second = pool.execute(async () => { queuedRan = true; });
  const settled = Promise.allSettled([first, second]);
  await started.promise;
  pool.shutdown(); pool.shutdown();
  const results = await settled;
  assert.ok(results.every(r => r.status === 'rejected' && /shut down/.test(r.reason.message)));
  await assert.rejects(pool.execute(async () => {}), /shut down/);
  await pool.waitForCompletion();
  assert.equal(queuedRan, false);
  assert.deepEqual(pool.getStats(), { active: 0, queued: 0, max: 1 });
});

test('queued cancellation removes work without consuming a slot, and active slots wait for settlement', async () => {
  const pool = new WorkerPool(1); const blocker = gate();
  const first = pool.execute(async () => blocker.promise);
  const controller = new AbortController();
  const second = pool.execute(async () => assert.fail('cancelled task ran'), { signal: controller.signal });
  const rejected = assert.rejects(second, /cancelled/);
  controller.abort(new Error('cancelled'));
  await rejected;
  assert.equal(pool.getStats().queued, 0);
  pool.shutdown();
  assert.equal(pool.getStats().active, 1);
  const stopped = assert.rejects(first, /shut down/);
  blocker.release(); await stopped; await pool.waitForCompletion();
});

test('pre-aborted work never starts and invalid concurrency is rejected', async () => {
  for (const size of [0, -1, 1.2, NaN, Infinity]) assert.throws(() => new WorkerPool(size), /positive integer/);
  const controller = new AbortController(); controller.abort(new Error('already cancelled'));
  await assert.rejects(new WorkerPool().execute(async () => assert.fail('started'), { signal: controller.signal }), /already cancelled/);
});

test('drain deadline reports unfinished work rather than claiming completion', async () => {
  const pool = new WorkerPool(1); const blocker = gate();
  const task = pool.execute(async () => blocker.promise);
  await assert.rejects(pool.waitForCompletion(5), /did not finish/);
  blocker.release(); await task; await pool.waitForCompletion();
});

test('many synchronous failures cannot overflow the queue drain stack', async () => {
  const pool = new WorkerPool(1); const blocker = gate();
  const first = pool.execute(async () => blocker.promise);
  const tasks = Array.from({ length: 3000 }, () => pool.execute(() => { throw new Error('expected'); }));
  const settled = Promise.allSettled([first, ...tasks]);
  blocker.release();
  assert.equal((await settled).filter(r => r.status === 'rejected').length, tasks.length);
  await pool.waitForCompletion();
});
