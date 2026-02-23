import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileIcon } from './FileIcon';
import { FolderIcon } from './FolderIcon';

interface VirtualIconViewProps {
  virtualTree: VirtualNode | null;
  isLoading: boolean;
  currentVirtualPath: string;
  selectedFileId?: string | null;
  onFileSelect?: (fileId: string | null) => void;
  onFileClick: (file: FileRecord) => void;
  onFileRightClick?: (file: FileRecord) => void;
  onFileCardClick?: (file: FileRecord) => void;
  onPathChange: (virtualPath: string) => void;
  onLoadChildren?: (virtualPath: string) => Promise<VirtualNode[]>;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function VirtualIconView({
  virtualTree,
  isLoading,
  currentVirtualPath,
  selectedFileId,
  onFileSelect,
  onFileClick,
  onFileRightClick,
  onFileCardClick,
  onPathChange,
  onLoadChildren,
}: VirtualIconViewProps) {
  const [loadedChildren, setLoadedChildren] = useState<Map<string, VirtualNode[]>>(new Map());
  const [loadingChildren, setLoadingChildren] = useState<Set<string>>(new Set());
  const [folderOrderByPath, setFolderOrderByPath] = useState<Record<string, string[]>>({});
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const selectedFileRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setLoadedChildren(new Map());
    setLoadingChildren(new Set());
    setFolderOrderByPath({});
  }, [virtualTree]);

  const findNode = useCallback(
    (node: VirtualNode, targetPath: string): VirtualNode | null => {
      if (node.path === targetPath) {
        return node;
      }
      const children = loadedChildren.get(node.path) ?? node.children;
      for (const child of children) {
        const found = findNode(child, targetPath);
        if (found) {
          return found;
        }
      }
      return null;
    },
    [loadedChildren]
  );

  useEffect(() => {
    if (!virtualTree || !onLoadChildren || currentVirtualPath === '/') {
      return;
    }

    if (loadedChildren.has(currentVirtualPath) || loadingChildren.has(currentVirtualPath)) {
      return;
    }

    setLoadingChildren((prev) => {
      if (prev.has(currentVirtualPath)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(currentVirtualPath);
      return next;
    });

    onLoadChildren(currentVirtualPath)
      .then((children) => {
        if (!isMountedRef.current) {
          return;
        }
        setLoadedChildren((prev) => {
          const next = new Map(prev);
          next.set(currentVirtualPath, children);
          return next;
        });
      })
      .catch((err) => {
        console.error('Failed to load virtual children for icon view:', err);
      })
      .finally(() => {
        if (!isMountedRef.current) {
          return;
        }
        setLoadingChildren((prev) => {
          const next = new Set(prev);
          next.delete(currentVirtualPath);
          return next;
        });
      });
  }, [virtualTree, currentVirtualPath, onLoadChildren, loadedChildren, loadingChildren]);

  const currentChildren = useMemo(() => {
    if (!virtualTree) {
      return [];
    }
    if (currentVirtualPath === '/') {
      return virtualTree.children;
    }
    const fromCache = loadedChildren.get(currentVirtualPath);
    if (fromCache) {
      return fromCache;
    }
    const node = findNode(virtualTree, currentVirtualPath);
    return node?.children ?? [];
  }, [virtualTree, currentVirtualPath, loadedChildren, findNode]);

  const folderNodes = useMemo(() => currentChildren.filter((node) => node.type === 'folder'), [currentChildren]);
  const folderIdsKey = useMemo(() => folderNodes.map((node) => node.id).join('|'), [folderNodes]);

  useEffect(() => {
    setFolderOrderByPath((prev) => {
      const existing = prev[currentVirtualPath] ?? [];
      const available = new Set(folderNodes.map((node) => node.id));
      const preserved = existing.filter((id) => available.has(id));
      const missing = folderNodes.map((node) => node.id).filter((id) => !preserved.includes(id));
      const nextOrder = [...preserved, ...missing];

      if (nextOrder.length === existing.length && nextOrder.every((id, index) => id === existing[index])) {
        return prev;
      }

      return {
        ...prev,
        [currentVirtualPath]: nextOrder,
      };
    });
  }, [currentVirtualPath, folderIdsKey, folderNodes]);

  const orderedFolderNodes = useMemo(() => {
    const folderMap = new Map(folderNodes.map((node) => [node.id, node]));
    const orderedIds = folderOrderByPath[currentVirtualPath] ?? folderNodes.map((node) => node.id);
    const ordered = orderedIds
      .map((nodeId) => folderMap.get(nodeId))
      .filter((node): node is VirtualNode => Boolean(node));
    if (ordered.length === folderNodes.length) {
      return ordered;
    }
    const orderedSet = new Set(ordered.map((node) => node.id));
    const missing = folderNodes.filter((node) => !orderedSet.has(node.id));
    return [...ordered, ...missing];
  }, [folderNodes, folderOrderByPath, currentVirtualPath]);

  const fileNodes = useMemo(() => currentChildren.filter((node) => node.type === 'file'), [currentChildren]);

  const reorderFolders = useCallback(
    (draggedId: string, targetId: string) => {
      setFolderOrderByPath((prev) => {
        const base = prev[currentVirtualPath] ?? folderNodes.map((node) => node.id);
        const next = [...base];
        const fromIndex = next.indexOf(draggedId);
        const toIndex = next.indexOf(targetId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
          return prev;
        }
        next.splice(fromIndex, 1);
        next.splice(toIndex, 0, draggedId);
        return {
          ...prev,
          [currentVirtualPath]: next,
        };
      });
    },
    [currentVirtualPath, folderNodes]
  );

  const handleFolderDragStart = useCallback((nodeId: string, event: React.DragEvent<HTMLDivElement>) => {
    setDraggedFolderId(nodeId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', nodeId);
  }, []);

  const handleFolderDragOver = useCallback(
    (targetNodeId: string, event: React.DragEvent<HTMLDivElement>) => {
      if (!draggedFolderId || draggedFolderId === targetNodeId) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      reorderFolders(draggedFolderId, targetNodeId);
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
    if (selectedFileId && selectedFileRef.current && !isLoading) {
      setTimeout(() => {
        if (selectedFileRef.current) {
          selectedFileRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [selectedFileId, isLoading, currentVirtualPath, currentChildren]);

  const handleNavigateUp = useCallback(() => {
    if (currentVirtualPath === '/') {
      return;
    }
    const parts = currentVirtualPath.split('/').filter((part) => part.length > 0);
    parts.pop();
    onPathChange(parts.length === 0 ? '/' : `/${parts.join('/')}`);
  }, [currentVirtualPath, onPathChange]);

  const handleContainerClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if ((target === event.currentTarget || target.classList.contains('icon-view-grid')) && onFileSelect) {
        onFileSelect(null);
      }
    },
    [onFileSelect]
  );

  if (isLoading) {
    return (
      <div className="icon-view-container">
        <div className="file-list-loading">Loading virtual tree...</div>
      </div>
    );
  }

  if (!virtualTree) {
    return (
      <div className="icon-view-container">
        <div className="file-list-empty">
          No virtual organization yet. Switch to "Filesystem" view, then click "Organize" to categorize files.
        </div>
      </div>
    );
  }

  const isLoadingCurrentPath = loadingChildren.has(currentVirtualPath);
  const isEmpty = currentChildren.length === 0;

  return (
    <div className="icon-view-container" onClick={handleContainerClick}>
      {currentVirtualPath !== '/' && (
        <div className="breadcrumb">
          <button className="breadcrumb-up" onClick={handleNavigateUp} title="Go up one level">
            <span className="breadcrumb-icon">←</span>
            <span className="breadcrumb-text">Back</span>
          </button>
          <span className="breadcrumb-path">{currentVirtualPath}</span>
        </div>
      )}

      {isLoadingCurrentPath ? (
        <div className="file-list-loading">Loading files...</div>
      ) : isEmpty ? (
        <div className="file-list-empty">
          {currentVirtualPath === '/'
            ? 'No virtual organization yet. Click "Organize" to categorize files.'
            : 'This virtual folder is empty.'}
        </div>
      ) : (
        <>
          {orderedFolderNodes.length > 1 && (
            <div className="icon-view-helper">Drag folder icons to reorder them in this view.</div>
          )}
          <div className="icon-view-grid" onClick={handleContainerClick}>
            {orderedFolderNodes.map((node) => (
              <div
                key={node.id}
                className={`icon-item icon-folder-item ${draggedFolderId === node.id ? 'dragging' : ''}`}
                draggable
                onDragStart={(event) => handleFolderDragStart(node.id, event)}
                onDragOver={(event) => handleFolderDragOver(node.id, event)}
                onDrop={handleFolderDrop}
                onDragEnd={handleFolderDragEnd}
                onClick={(event) => {
                  event.stopPropagation();
                  if (onFileSelect) {
                    onFileSelect(null);
                  }
                }}
                onDoubleClick={() => onPathChange(node.path)}
                title={`${node.path}\nDouble-click to open`}
              >
                <div className="icon-item-icon-wrap">
                  <FolderIcon className="icon-view-file-icon" />
                </div>
                <span className="icon-item-label">{node.name}</span>
                {typeof node.fileCount === 'number' && <span className="icon-item-meta">{node.fileCount} files</span>}
              </div>
            ))}

            {fileNodes.map((node) => {
              if (!node.fileRecord) {
                return null;
              }
              const file = node.fileRecord;
              const isSelected = selectedFileId === file.file_id;
              return (
                <div
                  key={node.id}
                  className={`icon-item icon-file-item ${isSelected ? 'selected' : ''}`}
                  ref={isSelected ? selectedFileRef : null}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (onFileSelect) {
                      onFileSelect(file.file_id);
                    }
                  }}
                  onDoubleClick={() => onFileClick(file)}
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
                  <span className="icon-item-label">{node.name}</span>
                  {node.placement && (
                    <span className="icon-item-meta">
                      {(node.placement.confidence * 100).toFixed(0)}% confidence
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
