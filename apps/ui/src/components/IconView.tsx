import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileIcon } from './FileIcon';
import { FolderIcon } from './FolderIcon';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';

interface IconViewProps {
  folders: FolderRecord[];
  files: FileRecord[];
  isLoading: boolean;
  hasMoreFiles?: boolean;
  isLoadingMoreFiles?: boolean;
  currentPath: string | null;
  isSearching: boolean;
  selectedFileId?: string | null;
  onFileSelect?: (fileId: string | null) => void;
  onFolderClick: (folder: FolderRecord) => void;
  onFolderDoubleClick: (folder: FolderRecord) => void;
  onFileDoubleClick: (file: FileRecord) => void;
  onFileRightClick?: (file: FileRecord) => void;
  onFileCardClick?: (file: FileRecord) => void;
  onNavigateUp: () => void;
  onLoadMoreFiles?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function IconView({
  folders,
  files,
  isLoading,
  hasMoreFiles = false,
  isLoadingMoreFiles = false,
  currentPath,
  isSearching,
  selectedFileId,
  onFileSelect,
  onFolderClick,
  onFolderDoubleClick,
  onFileDoubleClick,
  onFileRightClick,
  onFileCardClick,
  onNavigateUp,
  onLoadMoreFiles,
}: IconViewProps) {
  const [folderOrder, setFolderOrder] = useState<string[]>([]);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const selectedFileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setFolderOrder((prev) => {
      const availableIds = new Set(folders.map((folder) => folder.folder_id));
      const preserved = prev.filter((id) => availableIds.has(id));
      const missing = folders.map((folder) => folder.folder_id).filter((id) => !preserved.includes(id));
      const next = [...preserved, ...missing];

      if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
        return prev;
      }

      return next;
    });
  }, [folders]);

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.folder_id, folder])), [folders]);

  const orderedFolders = useMemo(() => {
    const ordered = folderOrder
      .map((folderId) => folderMap.get(folderId))
      .filter((folder): folder is FolderRecord => Boolean(folder));
    if (ordered.length === folders.length) {
      return ordered;
    }
    const orderedIds = new Set(ordered.map((folder) => folder.folder_id));
    const missing = folders.filter((folder) => !orderedIds.has(folder.folder_id));
    return [...ordered, ...missing];
  }, [folderMap, folderOrder, folders]);

  const reorderFolders = useCallback(
    (draggedId: string, targetId: string) => {
      setFolderOrder((prev) => {
        const baseOrder = prev.length > 0 ? [...prev] : folders.map((folder) => folder.folder_id);
        const fromIndex = baseOrder.indexOf(draggedId);
        const toIndex = baseOrder.indexOf(targetId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
          return prev.length > 0 ? prev : baseOrder;
        }
        baseOrder.splice(fromIndex, 1);
        baseOrder.splice(toIndex, 0, draggedId);
        return baseOrder;
      });
    },
    [folders]
  );

  const handleFolderDragStart = useCallback((folderId: string, event: React.DragEvent<HTMLDivElement>) => {
    setDraggedFolderId(folderId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', folderId);
  }, []);

  const handleFolderDragOver = useCallback(
    (targetFolderId: string, event: React.DragEvent<HTMLDivElement>) => {
      if (!draggedFolderId || draggedFolderId === targetFolderId) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      reorderFolders(draggedFolderId, targetFolderId);
    },
    [draggedFolderId, reorderFolders]
  );

  const handleFolderDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggedFolderId(null);
  }, []);

  const handleFolderDragEnd = useCallback(() => {
    setDraggedFolderId(null);
  }, []);

  useEffect(() => {
    if (selectedFileId && selectedFileRef.current && !isLoading && files.length > 0) {
      setTimeout(() => {
        if (selectedFileRef.current) {
          selectedFileRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [selectedFileId, isLoading, files.length]);

  const handleContainerClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if ((target === event.currentTarget || target.classList.contains('icon-view-grid')) && onFileSelect) {
        onFileSelect(null);
      }
    },
    [onFileSelect]
  );

  const handleFolderClickWrapper = useCallback(
    (folder: FolderRecord, event: React.MouseEvent) => {
      event.stopPropagation();
      if (onFileSelect) {
        onFileSelect(null);
      }
      onFolderClick(folder);
    },
    [onFileSelect, onFolderClick]
  );

  const handleFileClick = useCallback(
    (file: FileRecord, event: React.MouseEvent) => {
      event.stopPropagation();
      if (onFileSelect) {
        onFileSelect(file.file_id);
      }
    },
    [onFileSelect]
  );

  const setScrollContainerRef = useInfiniteScroll({
    hasMore: hasMoreFiles,
    isLoading: isLoading || isLoadingMoreFiles,
    onLoadMore: () => {
      onLoadMoreFiles?.();
    },
  });

  if (isLoading) {
    return (
      <div className="icon-view-container">
        <div className="file-list-loading">Loading...</div>
      </div>
    );
  }

  const isEmpty = folders.length === 0 && files.length === 0;

  return (
    <div className="icon-view-container" ref={setScrollContainerRef} onClick={handleContainerClick}>
      {currentPath !== null && (
        <div className="breadcrumb">
          <button className="breadcrumb-up" onClick={onNavigateUp} title="Go up one level">
            <span className="breadcrumb-icon">←</span>
            <span className="breadcrumb-text">Back</span>
          </button>
          <span className="breadcrumb-path">/{currentPath}</span>
        </div>
      )}

      {isEmpty ? (
        <div className="file-list-empty">
          {isSearching
            ? 'No matching files or folders found.'
            : currentPath === null
            ? 'No files found. Click "Scan" to index files.'
            : 'This folder is empty.'}
        </div>
      ) : (
        <>
          {!isSearching && orderedFolders.length > 1 && (
            <div className="icon-view-helper">Drag folder icons to reorder them in this view.</div>
          )}
          <div className="icon-view-grid" onClick={handleContainerClick}>
            {orderedFolders.map((folder) => (
              <div
                key={folder.folder_id}
                className={`icon-item icon-folder-item ${draggedFolderId === folder.folder_id ? 'dragging' : ''}`}
                draggable={!isSearching}
                onDragStart={(event) => handleFolderDragStart(folder.folder_id, event)}
                onDragOver={(event) => handleFolderDragOver(folder.folder_id, event)}
                onDrop={handleFolderDrop}
                onDragEnd={handleFolderDragEnd}
                onClick={(event) => handleFolderClickWrapper(folder, event)}
                onDoubleClick={() => onFolderDoubleClick(folder)}
                title={`${folder.path}\n${folder.item_count} items`}
              >
                <div className="icon-item-icon-wrap">
                  <FolderIcon className="icon-view-file-icon" />
                </div>
                <span className="icon-item-label">{folder.name}</span>
                {isSearching && folder.parent_path && <span className="icon-item-meta">/{folder.parent_path}</span>}
              </div>
            ))}

            {files.map((file) => {
              const isSelected = selectedFileId === file.file_id;
              return (
                <div
                  key={file.file_id}
                  className={`icon-item icon-file-item ${isSelected ? 'selected' : ''}`}
                  ref={isSelected ? selectedFileRef : null}
                  onClick={(event) => handleFileClick(file, event)}
                  onDoubleClick={() => onFileDoubleClick(file)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (onFileRightClick) {
                      onFileRightClick(file);
                    }
                  }}
                  title={`${file.path}\n${formatFileSize(file.size)}`}
                >
                  <div className="icon-item-icon-wrap">
                    <FileIcon extension={file.extension || ''} className="icon-view-file-icon" />
                    <button
                      type="button"
                      className="icon-file-card-indicator"
                      title="View file card"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (onFileCardClick) {
                          onFileCardClick(file);
                        } else if (onFileRightClick) {
                          onFileRightClick(file);
                        }
                      }}
                    >
                      ℹ️
                    </button>
                  </div>
                  <span className="icon-item-label">{file.name}</span>
                  {isSearching && file.parent_path && <span className="icon-item-meta">/{file.parent_path}</span>}
                </div>
              );
            })}
          </div>

          {files.length > 0 && (
            <div className="file-list-end">
              {isLoadingMoreFiles
                ? 'Loading more files...'
                : hasMoreFiles
                ? `Showing ${files.length.toLocaleString()} files. Scroll to load more...`
                : `Showing ${files.length.toLocaleString()} file${files.length !== 1 ? 's' : ''}`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
