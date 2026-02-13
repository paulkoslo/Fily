/**
 * Worker Pool for managing concurrent AI API calls
 * 
 * Limits concurrent AI operations (OpenAI API calls) to a maximum of WORKER_POOL_DEFAULT_MAX_WORKERS.
 * Each AI agent call (SummaryTagAgent batch, Audio transcription, etc.) counts as 1 worker.
 * 
 * Logging is minimal - only errors and important state changes are logged.
 */

import { WORKER_POOL_DEFAULT_MAX_WORKERS, WORKER_POOL_MAX_ITERATIONS, WORKER_POOL_CHECK_INTERVAL_MS } from '../planner/constants';

export class WorkerPool {
  private maxWorkers: number;
  private activeWorkers: number = 0;
  private queue: Array<() => Promise<any>> = [];
  private running: boolean = true;

  constructor(maxWorkers: number = WORKER_POOL_DEFAULT_MAX_WORKERS) {
    this.maxWorkers = maxWorkers;
  }

  /**
   * Execute a task through the worker pool
   * If at capacity, the task will be queued until a worker becomes available
   */
  async execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        const workerId = this.activeWorkers; // Track worker ID (already incremented)
        const startTime = Date.now();
        try {
          const result = await task();
          const duration = Date.now() - startTime;
          // Log slow workers (>30 seconds)
          if (duration > 30000) {
            console.warn(`[WorkerPool] Worker ${workerId} completed slowly after ${duration}ms`);
          }
          resolve(result);
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`[WorkerPool] Worker ${workerId} failed after ${duration}ms:`, error);
          reject(error);
        } finally {
          this.activeWorkers--;
          // CRITICAL: Immediately process queue when worker becomes free
          // This ensures next batch starts as soon as a worker is available
          setImmediate(() => this.processQueue());
        }
      };

      if (this.activeWorkers < this.maxWorkers) {
        // CRITICAL: Increment BEFORE starting task to prevent race conditions
        // This ensures we don't exceed maxWorkers when multiple tasks are submitted simultaneously
        this.activeWorkers++;
        // Start task immediately - don't await, let it run concurrently
        wrappedTask();
      } else {
        // Queue is full, add to queue (will be processed when worker becomes free)
        this.queue.push(wrappedTask);
      }
    });
  }

  /**
   * Process queued tasks when workers become available
   * Starts multiple tasks concurrently up to maxWorkers limit
   */
  private processQueue(): void {
    // Start as many tasks as we can concurrently
    let started = 0;
    while (this.queue.length > 0 && this.activeWorkers < this.maxWorkers && this.running) {
      const task = this.queue.shift();
      if (task) {
        // CRITICAL: Increment BEFORE starting task to prevent race conditions
        // This ensures we don't exceed maxWorkers when processing queue
        this.activeWorkers++;
        // Start task immediately - don't await, let it run concurrently
        task();
        started++;
      }
    }
    // Removed verbose queue processing logs - batches will show their own progress
  }

  /**
   * Get current worker statistics
   */
  getStats(): { active: number; queued: number; max: number } {
    return {
      active: this.activeWorkers,
      queued: this.queue.length,
      max: this.maxWorkers,
    };
  }

  /**
   * Log current worker pool state (for debugging)
   */
  logStats(): void {
    const stats = this.getStats();
    console.log(`[WorkerPool] Stats: ${stats.active}/${stats.max} active, ${stats.queued} queued`);
  }

  /**
   * Wait for all active workers to complete
   */
  async waitForCompletion(): Promise<void> {
    let iterations = 0;
    const maxIterations = WORKER_POOL_MAX_ITERATIONS;
    while ((this.activeWorkers > 0 || this.queue.length > 0) && iterations < maxIterations) {
      await new Promise(resolve => setTimeout(resolve, WORKER_POOL_CHECK_INTERVAL_MS));
      iterations++;
    }
    if (iterations >= maxIterations) {
      console.warn(`[WorkerPool] waitForCompletion timeout: ${this.activeWorkers} active, ${this.queue.length} queued`);
    }
  }

  /**
   * Shutdown the worker pool (stop processing new tasks)
   */
  shutdown(): void {
    this.running = false;
  }
}
