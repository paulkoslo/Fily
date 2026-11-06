import { AsyncLocalStorage } from 'node:async_hooks';

// Keeps cancellation attached to nested agent calls without double-queuing them.
const requests = new AsyncLocalStorage<AbortSignal>();
export const currentRequestSignal = (): AbortSignal | undefined => requests.getStore();
export function withRequestSignal<T>(signal: AbortSignal, task: () => T): T {
  return requests.run(signal, task);
}

export async function withRequestDeadline<T>(
  task: () => Promise<T>, timeoutMs: number, description: string, externalSignal?: AbortSignal
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Request deadline must be positive');
  const controller = new AbortController();
  const parents = [currentRequestSignal(), externalSignal].filter((signal): signal is AbortSignal => !!signal);
  const signal = AbortSignal.any([controller.signal, ...parents]);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  const timer = setTimeout(() => controller.abort(new Error(`${description} timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await withRequestSignal(signal, () => Promise.race([
      Promise.resolve().then(() => { signal.throwIfAborted(); return task(); }), aborted,
    ]));
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
