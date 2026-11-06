import { open } from 'node:fs/promises';
import { BASE64_IMAGE_MAX_SIZE_BYTES } from '../planner/constants';

/** Read at most the supported image payload, even if the file grows mid-read. */
export async function loadImageForAnalysis(filename: string, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const handle = await open(filename, 'r');
  try {
    const limit = Math.floor(BASE64_IMAGE_MAX_SIZE_BYTES / 4) * 3;
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Image exceeds the analysis size limit');
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      signal?.throwIfAborted();
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw new Error('Image exceeds the analysis size limit');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    signal?.throwIfAborted();
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}
