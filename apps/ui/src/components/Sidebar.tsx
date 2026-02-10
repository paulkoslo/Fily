import { useCallback } from 'react';

interface SidebarProps {
  sources: Source[];
  selectedSourceId: number | null;
  watchingSourceIds: Set<number>;
  onSourceSelect: (sourceId: number) => void;
  onAddSource: () => void;
  onRemoveSource: (sourceId: number) => void;
  onToggleWatch?: (sourceId: number) => void;
}

export function Sidebar({
  sources,
  selectedSourceId,
  watchingSourceIds,
  onSourceSelect,
  onAddSource,
  onRemoveSource,
  onToggleWatch,
}: SidebarProps) {
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, sourceId: number) => {
      e.preventDefault();
      // Simple confirm dialog for removal
      if (window.confirm('Remove this source folder? (Files will not be deleted from disk)')) {
        onRemoveSource(sourceId);
      }
    },
    [onRemoveSource]
  );

  const handleWatchToggle = useCallback(
    (e: React.MouseEvent, sourceId: number) => {
      e.stopPropagation(); // Don't trigger source selection
      if (onToggleWatch) {
        onToggleWatch(sourceId);
      }
    },
    [onToggleWatch]
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">Sources</div>
      <ul className="sidebar-list">
        {sources.map((source) => (
          <li
            key={source.id}
            className={`sidebar-item ${selectedSourceId === source.id ? 'selected' : ''}`}
            onClick={() => onSourceSelect(source.id)}
            onContextMenu={(e) => handleContextMenu(e, source.id)}
            title={`${source.path}\n\nRight-click to remove`}
          >
            <span className="sidebar-icon">📁</span>
            <span className="sidebar-item-name">{source.name}</span>
            <span
              className={`watch-indicator ${watchingSourceIds.has(source.id) ? 'watching' : 'not-watching'}`}
              title={watchingSourceIds.has(source.id) ? 'Watching for changes (click to stop)' : 'Not watching (click to start)'}
              onClick={(e) => handleWatchToggle(e, source.id)}
            >
              {watchingSourceIds.has(source.id) ? '✓' : '○'}
            </span>
          </li>
        ))}
      </ul>
      <div className="sidebar-footer">
        <button className="add-source-button" onClick={onAddSource}>
          <span className="add-icon">+</span>
          <span>Add Folder</span>
        </button>
      </div>
    </aside>
  );
}
