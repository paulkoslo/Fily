import { useState, useCallback, useEffect, useRef } from 'react';
import { FileIcon } from './FileIcon';
import { FolderIcon } from './FolderIcon';

interface VirtualTreeViewProps {
  virtualTree: VirtualNode | null;
  isLoading: boolean;
  currentVirtualPath: string;
  selectedFileId?: string | null; // File ID to highlight/select
  onFileSelect?: (fileId: string | null) => void; // Callback to update selection
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

export function VirtualTreeView({
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
}: VirtualTreeViewProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/']));
  const [loadedChildren, setLoadedChildren] = useState<Map<string, VirtualNode[]>>(new Map());
  const [loadingChildren, setLoadingChildren] = useState<Set<string>>(new Set());
  const selectedFileRef = useRef<HTMLDivElement | null>(null);

  // Scroll to selected file when it becomes visible (wait for tree to load)
  useEffect(() => {
    if (selectedFileId && selectedFileRef.current && !isLoading && virtualTree) {
      // Small delay to ensure DOM is updated and tree is expanded
      setTimeout(() => {
        if (selectedFileRef.current) {
          selectedFileRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 200);
    }
  }, [selectedFileId, isLoading, virtualTree]);

  // Auto-expand path to current node when path changes and load children if needed
  useEffect(() => {
    if (!virtualTree || currentVirtualPath === '/') {
      return;
    }

    // Expand all parent paths leading to current path
    const pathParts = currentVirtualPath.split('/').filter((p) => p.length > 0);
    const pathsToExpand: string[] = ['/'];
    let currentPath = '';
    for (const part of pathParts) {
      currentPath += '/' + part;
      pathsToExpand.push(currentPath);
    }
    
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      pathsToExpand.forEach((p) => next.add(p));
      return next;
    });

    // Load children for all parent paths if they're not loaded (for lazy loading)
    if (onLoadChildren) {
      const findNodeRecursive = (node: VirtualNode, targetPath: string): VirtualNode | null => {
        if (node.path === targetPath) {
          return node;
        }
        const childrenToCheck = loadedChildren.get(node.path) || node.children;
        for (const child of childrenToCheck) {
          const found = findNodeRecursive(child, targetPath);
          if (found) return found;
        }
        return null;
      };

      const loadPathChildren = async (path: string) => {
        // Check if children are already loaded or currently loading
        if (loadedChildren.has(path) || loadingChildren.has(path)) {
          return;
        }

        // Always load children for the path (don't check if node exists or has children)
        // This ensures files are visible when navigating from search
        setLoadingChildren((prev) => new Set(prev).add(path));
        try {
          const children = await onLoadChildren(path);
          setLoadedChildren((prev) => {
            const next = new Map(prev);
            next.set(path, children);
            return next;
          });
        } catch (err) {
          console.error('Failed to load children for path:', path, err);
        } finally {
          setLoadingChildren((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        }
      };

      // Load children for all paths leading to AND including current path
      // This ensures the current path's children are loaded so files are visible
      // Load in order: root first, then each parent, then current path
      (async () => {
        for (let i = 0; i < pathsToExpand.length; i++) {
          await loadPathChildren(pathsToExpand[i]);
        }
      })();
    }
  }, [virtualTree, currentVirtualPath, onLoadChildren]);

  const toggleExpand = useCallback((path: string, event?: React.MouseEvent) => {
    // Prevent navigation when toggling expand
    if (event) {
      event.stopPropagation();
    }
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Single click: expand/collapse folder
  const handleFolderClick = useCallback(
    async (node: VirtualNode, event: React.MouseEvent) => {
      if (node.type === 'folder') {
        // Clear selection when clicking folder
        event.stopPropagation(); // Prevent container click
        if (onFileSelect) {
          onFileSelect(null);
        }
        
        const wasExpanded = expandedPaths.has(node.path);
        toggleExpand(node.path, event);
        
        // If expanding and folder has no children (lazy loading), load them
        if (!wasExpanded && node.children.length === 0 && onLoadChildren) {
          setLoadingChildren((prev) => new Set(prev).add(node.path));
          try {
            const children = await onLoadChildren(node.path);
            setLoadedChildren((prev) => {
              const next = new Map(prev);
              next.set(node.path, children);
              return next;
            });
          } catch (err) {
            console.error('Failed to load children:', err);
          } finally {
            setLoadingChildren((prev) => {
              const next = new Set(prev);
              next.delete(node.path);
              return next;
            });
          }
        }
      }
    },
    [toggleExpand, expandedPaths, onLoadChildren, onFileSelect]
  );

  // Double click: navigate into folder
  const handleFolderDoubleClick = useCallback(
    (node: VirtualNode) => {
      if (node.type === 'folder') {
        onPathChange(node.path);
      }
    },
    [onPathChange]
  );

  const handleFileDoubleClick = useCallback(
    (file: FileRecord) => {
      onFileClick(file);
    },
    [onFileClick]
  );

  const handleNavigateUp = useCallback(() => {
    if (currentVirtualPath === '/') return;
    const parts = currentVirtualPath.split('/').filter((p) => p.length > 0);
    parts.pop();
    const newPath = parts.length === 0 ? '/' : '/' + parts.join('/');
    onPathChange(newPath);
  }, [currentVirtualPath, onPathChange]);

  const renderBreadcrumb = () => {
    if (currentVirtualPath === '/') return null;
    return (
      <div className="breadcrumb">
        <button className="breadcrumb-up" onClick={handleNavigateUp} title="Go up one level">
          <span className="breadcrumb-icon">←</span>
          <span className="breadcrumb-text">Back</span>
        </button>
        <span className="breadcrumb-path">{currentVirtualPath}</span>
      </div>
    );
  };

  const renderNode = (node: VirtualNode, depth: number = 0): JSX.Element | null => {
    if (node.type === 'file') {
      if (!node.fileRecord) return null;
      const file = node.fileRecord;
      const isSelected = selectedFileId === file.file_id;
      return (
        <div
          key={node.id}
          className={`file-item ${isSelected ? 'selected' : ''}`}
          ref={isSelected ? selectedFileRef : null}
          onClick={(e) => handleFileClick(file, e)}
          onDoubleClick={() => handleFileDoubleClick(file)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (onFileRightClick) {
              onFileRightClick(file);
            }
          }}
          title={file.path}
        >
          <div className="file-name">
            <FileIcon extension={file.extension || ''} />
            <div className="file-name-content">
              <span className="file-name-text">{node.name}</span>
              {node.placement && node.placement.tags.length > 0 && (
                <span className="file-path-hint">
                  {node.placement.tags.slice(0, 3).join(', ')}
                </span>
              )}
            </div>
            <span
              className="file-content-indicator"
              title="Click to view file card (or right-click row for full details)"
              onClick={(e) => {
                e.stopPropagation();
                if (onFileCardClick) {
                  onFileCardClick(file);
                } else if (onFileRightClick) {
                  onFileRightClick(file);
                }
              }}
            >
              ℹ️
            </span>
          </div>
          <div className="file-extension">{file.extension || '—'}</div>
          <div className="file-size">{formatFileSize(file.size)}</div>
          {node.placement && (
            <div className="file-date" title={`Confidence: ${(node.placement.confidence * 100).toFixed(0)}%`}>
              {(node.placement.confidence * 100).toFixed(0)}%
            </div>
          )}
        </div>
      );
    }

    // Folder node
    const isExpanded = expandedPaths.has(node.path);
    const isLoadingChildren = loadingChildren.has(node.path);

    // Get children - either from node or from loaded children cache
    const childrenToRender = loadedChildren.get(node.path) || node.children;

    return (
      <div key={node.id}>
        <div
          className="file-item folder-item"
          onClick={(e) => handleFolderClick(node, e)}
          onDoubleClick={() => handleFolderDoubleClick(node)}
          title={`${node.path}\nSingle-click to expand/collapse\nDouble-click to navigate`}
        >
          <div className="file-name">
            <FolderIcon />
            <div className="file-name-content">
              <span className="file-name-text">{node.name}</span>
            </div>
          </div>
          <div className="file-extension">Folder</div>
          <div className="file-size">—</div>
          <div className="file-date">{isExpanded ? '−' : '+'}</div>
        </div>
        {isExpanded && (
          <div style={{ marginLeft: '20px' }}>
            {isLoadingChildren ? (
              <div className="file-list-loading" style={{ padding: '10px' }}>Loading...</div>
            ) : (
              childrenToRender.map((child) => renderNode(child, depth + 1))
            )}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="file-list-container">
        <div className="file-list-loading">Loading virtual tree...</div>
      </div>
    );
  }

  if (!virtualTree) {
    return (
      <div className="file-list-container">
        <div className="file-list-empty">
          No virtual organization yet. Switch to "Filesystem" view to see files, then click "Extract Content" to extract content from files.
        </div>
      </div>
    );
  }

  // If we're at root, show full tree. Otherwise, show only current path's children (FileBrowser style)
  const findNode = (node: VirtualNode, path: string): VirtualNode | null => {
    if (node.path === path) {
      return node;
    }
    // Check both node.children and loadedChildren (for lazy loading)
    const childrenToCheck = loadedChildren.get(node.path) || node.children;
    for (const child of childrenToCheck) {
      const found = findNode(child, path);
      if (found) return found;
    }
    return null;
  };

  // For non-root paths, always use loadedChildren if available (they're loaded via getVirtualChildren)
  // For root, use tree children directly
  const isRoot = currentVirtualPath === '/';
  let currentChildren: VirtualNode[] = [];
  
  if (isRoot) {
    // Root: use tree children directly
    currentChildren = virtualTree.children;
  } else {
    // Non-root: use loadedChildren if available, otherwise try to find node
    if (loadedChildren.has(currentVirtualPath)) {
      currentChildren = loadedChildren.get(currentVirtualPath)!;
    } else {
      // Fallback: try to find node in tree (might not have children if lazy loaded)
      const currentNode = findNode(virtualTree, currentVirtualPath);
      currentChildren = currentNode ? currentNode.children : [];
    }
  }
  
  const isEmpty = currentChildren.length === 0;

  // Check if we're loading children for the current path
  const isLoadingCurrentPath = loadingChildren.has(currentVirtualPath);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    // Clear selection when clicking anywhere in the container (not on a file/folder)
    // Check if the click target is the container or file-list itself
    const target = e.target as HTMLElement;
    if ((target === e.currentTarget || target.classList.contains('file-list')) && onFileSelect) {
      onFileSelect(null);
    }
  }, [onFileSelect]);

  const handleFileClick = useCallback((file: FileRecord, e: React.MouseEvent) => {
    // Select file on single click
    e.stopPropagation(); // Prevent container click from clearing selection
    if (onFileSelect) {
      onFileSelect(file.file_id);
    }
    // Don't prevent default - allow double-click to still work
  }, [onFileSelect]);

  return (
    <div className="file-list-container" onClick={handleContainerClick}>
      {renderBreadcrumb()}
      {isLoadingCurrentPath ? (
        <div className="file-list-loading">Loading files...</div>
      ) : isEmpty ? (
        <div className="file-list-empty">
          {currentVirtualPath === '/'
            ? 'No virtual organization yet. Click "Organize" to categorize files.'
            : 'This virtual folder is empty.'}
        </div>
      ) : (
        <div className="file-list" onClick={handleContainerClick}>
          {isRoot
            ? // Root view: Show full tree with expand/collapse
              virtualTree.children.map((child) => renderNode(child, 0))
            : // Folder view: Show only current folder's children (like FileBrowser)
              currentChildren.map((child) => {
                // Render as simple list items (no nesting)
                if (child.type === 'file') {
                  if (!child.fileRecord) return null;
                  const file = child.fileRecord;
                  const isSelected = selectedFileId === file.file_id;
                  return (
                    <div
                      key={child.id}
                      className={`file-item ${isSelected ? 'selected' : ''}`}
                      ref={isSelected ? selectedFileRef : null}
                      onClick={(e) => handleFileClick(file, e)}
                      onDoubleClick={() => handleFileDoubleClick(file)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (onFileRightClick) {
                          onFileRightClick(file);
                        }
                      }}
                      title={file.path}
                    >
                      <div className="file-name">
                        <FileIcon extension={file.extension || ''} />
                        <div className="file-name-content">
                          <span className="file-name-text">{child.name}</span>
                          {child.placement && child.placement.tags.length > 0 && (
                            <span className="file-path-hint">
                              {child.placement.tags.slice(0, 3).join(', ')}
                            </span>
                          )}
                        </div>
                        <span
                          className="file-content-indicator"
                          title="Click to view file card (or right-click row for full details)"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onFileCardClick) {
                              onFileCardClick(file);
                            } else if (onFileRightClick) {
                              onFileRightClick(file);
                            }
                          }}
                        >
                          ℹ️
                        </span>
                      </div>
                      <div className="file-extension">{file.extension || '—'}</div>
                      <div className="file-size">{formatFileSize(file.size)}</div>
                      {child.placement && (
                        <div className="file-date" title={`Confidence: ${(child.placement.confidence * 100).toFixed(0)}%`}>
                          {(child.placement.confidence * 100).toFixed(0)}%
                        </div>
                      )}
                    </div>
                  );
                } else {
                  // Folder in folder view - double click navigates
                  return (
                    <div
                      key={child.id}
                      className="file-item folder-item"
                      onClick={(e) => handleFolderClick(child, e)}
                      onDoubleClick={() => handleFolderDoubleClick(child)}
                      title={`${child.path}\nDouble-click to open`}
                    >
                      <div className="file-name">
                        <FolderIcon />
                        <div className="file-name-content">
                          <span className="file-name-text">{child.name}</span>
                        </div>
                      </div>
                      <div className="file-extension">Folder</div>
                      <div className="file-size">—</div>
                      <div className="file-date">—</div>
                    </div>
                  );
                }
              })}
        </div>
      )}
    </div>
  );
}
