import { useState, useEffect } from 'react';

interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function MemoryInfo() {
  const [memory, setMemory] = useState<MemoryUsage | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const updateMemory = async () => {
      try {
        const response = await window.api.getMemoryUsage();
        if (response.success && response.memory) {
          setMemory(response.memory);
        }
      } catch (err) {
        console.error('Failed to get memory usage:', err);
      }
    };

    // Update immediately
    updateMemory();

    // Update every 2 seconds
    const interval = setInterval(updateMemory, 2000);

    return () => clearInterval(interval);
  }, []);

  if (!memory) {
    return null;
  }

  const totalMemory = memory.heapUsed + memory.external;
  const heapPercent = memory.heapTotal > 0 ? (memory.heapUsed / memory.heapTotal) * 100 : 0;

  return (
    <div className="memory-info">
      <button
        className="memory-info-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        title="Click to expand memory details"
      >
        <span className="memory-icon">Mem</span>
        <span className="memory-total">{formatBytes(totalMemory)}</span>
        {isExpanded && <span className="memory-arrow">▼</span>}
        {!isExpanded && <span className="memory-arrow">▶</span>}
      </button>
      {isExpanded && (
        <div className="memory-details">
          <div className="memory-detail-row">
            <span className="memory-label">Heap Used:</span>
            <span className="memory-value">{formatBytes(memory.heapUsed)}</span>
            <div className="memory-bar-container">
              <div
                className="memory-bar memory-bar-heap"
                style={{ width: `${Math.min(heapPercent, 100)}%` }}
              />
            </div>
          </div>
          <div className="memory-detail-row">
            <span className="memory-label">Heap Total:</span>
            <span className="memory-value">{formatBytes(memory.heapTotal)}</span>
          </div>
          <div className="memory-detail-row">
            <span className="memory-label">External:</span>
            <span className="memory-value">{formatBytes(memory.external)}</span>
          </div>
          <div className="memory-detail-row">
            <span className="memory-label">RSS:</span>
            <span className="memory-value">{formatBytes(memory.rss)}</span>
          </div>
          <div className="memory-detail-row">
            <span className="memory-label">Total:</span>
            <span className="memory-value memory-value-total">{formatBytes(totalMemory)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
