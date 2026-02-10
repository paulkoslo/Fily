/**
 * Worker Pool for managing concurrent AI API calls
 * 
 * Limits concurrent AI operations (OpenAI API calls) to a maximum of 50 workers.
 * Each AI agent call (Summary Agent, Audio transcription, etc.) counts as 1 worker.
 */

export class WorkerPool {
  private maxWorkers: number;
  private activeWorkers: number = 0;
  private queue: Array<() => Promise<any>> = [];
  private running: boolean = true;

  constructor(maxWorkers: number = 50) {
    this.maxWorkers = maxWorkers;
  }

  /**
   * Execute a task through the worker pool
   * If at capacity, the task will be queued until a worker becomes available
   */
  async execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        const workerId = ++this.activeWorkers;
        const startTime = Date.now();
        try {
          const result = await task();
          const duration = Date.now() - startTime;
          console.log(`[WorkerPool] Worker ${workerId} completed in ${duration}ms (${this.activeWorkers - 1} active, ${this.queue.length} queued)`);
          resolve(result);
        } catch (error) {
          const duration = Date.now() - startTime;
          console.log(`[WorkerPool] Worker ${workerId} failed after ${duration}ms`);
          reject(error);
        } finally {
          this.activeWorkers--;
          // Process queue asynchronously to avoid blocking and ensure concurrent execution
          setImmediate(() => this.processQueue());
        }
      };

      if (this.activeWorkers < this.maxWorkers) {
        // Start task immediately - don't await, let it run concurrently
        console.log(`[WorkerPool] Starting worker immediately (${this.activeWorkers + 1}/${this.maxWorkers} active)`);
        wrappedTask();
      } else {
        console.log(`[WorkerPool] Queuing task (${this.activeWorkers}/${this.maxWorkers} active, ${this.queue.length + 1} queued)`);
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
        // Start task immediately - don't await, let it run concurrently
        task();
        started++;
      }
    }
    if (started > 0) {
      console.log(`[WorkerPool] Started ${started} queued tasks (${this.activeWorkers}/${this.maxWorkers} active, ${this.queue.length} remaining)`);
    }
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
   * Wait for all active workers to complete
   */
  async waitForCompletion(): Promise<void> {
    let iterations = 0;
    const maxIterations = 10000; // Safety limit (1000 seconds max wait)
    while ((this.activeWorkers > 0 || this.queue.length > 0) && iterations < maxIterations) {
      await new Promise(resolve => setTimeout(resolve, 50)); // Check more frequently
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
