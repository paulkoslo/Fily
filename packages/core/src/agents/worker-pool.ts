import { WORKER_POOL_DEFAULT_MAX_WORKERS, WORKER_POOL_DRAIN_TIMEOUT_MS } from '../planner/constants';
import { currentRequestSignal, withRequestSignal } from './request-context';

type QueuedTask = { start: () => void; controller: AbortController };

/** Bounds concurrent asynchronous API work; these are not OS worker threads. */
export class WorkerPool {
  private activeWorkers = 0;
  private queue: QueuedTask[] = [];
  private running = true;
  private active = new Set<AbortController>();
  private idleListeners = new Set<() => void>();

  constructor(private maxWorkers: number = WORKER_POOL_DEFAULT_MAX_WORKERS) {
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1) throw new Error('Worker count must be a positive integer');
  }

  execute<T>(task: (signal: AbortSignal) => Promise<T>, options?: { signal?: AbortSignal }): Promise<T> {
    if (!this.running) return Promise.reject(new Error('Worker pool is shut down'));
    const controller = new AbortController();
    const parents = [currentRequestSignal(), options?.signal].filter((signal): signal is AbortSignal => !!signal);
    const signal = AbortSignal.any([controller.signal, ...parents]);
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      let started = false;
      const onAbort = () => {
        if (started) return; // Active work releases its slot only after settling.
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        signal.removeEventListener('abort', onAbort);
        reject(signal.reason);
        this.notifyIdle();
      };
      const entry: QueuedTask = { controller, start: () => {
        started = true;
        this.activeWorkers++;
        this.active.add(controller);
        void withRequestSignal(signal, async () => {
          try {
            await Promise.resolve();
            signal.throwIfAborted();
            const result = await task(signal);
            signal.throwIfAborted();
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            signal.removeEventListener('abort', onAbort);
            this.active.delete(controller);
            this.activeWorkers--;
            this.processQueue();
            this.notifyIdle();
          }
        });
      } };
      signal.addEventListener('abort', onAbort, { once: true });
      this.queue.push(entry);
      this.processQueue();
    });
  }

  private processQueue(): void {
    while (this.running && this.queue.length > 0 && this.activeWorkers < this.maxWorkers) {
      this.queue.shift()!.start();
    }
  }

  private notifyIdle(): void {
    if (this.activeWorkers === 0 && this.queue.length === 0) {
      for (const listener of this.idleListeners) listener();
    }
  }

  getStats(): { active: number; queued: number; max: number } {
    return { active: this.activeWorkers, queued: this.queue.length, max: this.maxWorkers };
  }

  logStats(): void {
    const stats = this.getStats();
    console.log(`[WorkerPool] Stats: ${stats.active}/${stats.max} active, ${stats.queued} queued`);
  }

  waitForCompletion(timeoutMs = WORKER_POOL_DRAIN_TIMEOUT_MS): Promise<void> {
    if (this.activeWorkers === 0 && this.queue.length === 0) return Promise.resolve();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('Drain deadline must be positive'));
    return new Promise((resolve, reject) => {
      const idle = () => { clearTimeout(timer); this.idleListeners.delete(idle); resolve(); };
      const timer = setTimeout(() => {
        this.idleListeners.delete(idle);
        reject(new Error('Worker pool did not finish before its deadline'));
      }, timeoutMs);
      this.idleListeners.add(idle);
    });
  }

  /** Reject queued work and signal active requests; never leave queued promises pending. */
  shutdown(): void {
    this.running = false;
    const reason = new Error('Worker pool is shut down');
    for (const entry of [...this.queue]) entry.controller.abort(reason);
    for (const controller of this.active) controller.abort(reason);
    this.notifyIdle();
  }
}
