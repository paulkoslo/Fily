import { useState, useCallback, useEffect } from 'react';

interface VirtualTreeViewProps {
  virtualTree: VirtualNode | null;
  isLoading: boolean;
  currentVirtualPath: string;
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

function getFileIcon(extension: string): string {
  const ext = extension.toLowerCase();
  if (['pdf'].includes(ext)) return '📕';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return '📝';
  if (['txt', 'md'].includes(ext)) return '📄';
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return '📊';
  if (['ppt', 'pptx', 'key'].includes(ext)) return '📽️';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'heic'].includes(ext)) return '🖼️';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return '🎵';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return '📦';
  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) return '📜';
  if (['py'].includes(ext)) return '🐍';
  if (['json', 'yaml', 'yml', 'xml'].includes(ext)) return '📋';
  if (['html', 'css', 'scss'].includes(ext)) return '🌐';
  return '📄';
}


export function VirtualTreeView({
  virtualTree,
  isLoading,
  currentVirtualPath,
  onFileClick,
  onFileRightClick,
  onFileCardClick,
  onPathChange,
  onLoadChildren,
}: VirtualTreeViewProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/']));
  const [loadedChildren, setLoadedChildren] = useState<Map<string, VirtualNode[]>>(new Map());
  const [loadingChildren, setLoadingChildren] = useState<Set<string>>(new Set());

  // Auto-expand path to current node when path changes
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
  }, [virtualTree, currentVirtualPath]);

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
    [toggleExpand, expandedPaths, onLoadChildren]
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
      return (
        <div
          key={node.id}
          className="file-item"
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
            <span className="file-icon">{getFileIcon(file.extension)}</span>
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
            <span className="file-icon folder-icon">
              {isExpanded ? '📂' : '📁'}
            </span>
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
    for (const child of node.children) {
      const found = findNode(child, path);
      if (found) return found;
    }
    return null;
  };

  const currentNode = findNode(virtualTree, currentVirtualPath) || virtualTree;
  const isEmpty = currentNode.children.length === 0;
  const isRoot = currentVirtualPath === '/';

  return (
    <div className="file-list-container">
      {renderBreadcrumb()}
      {isEmpty ? (
        <div className="file-list-empty">
          {currentVirtualPath === '/'
            ? 'No virtual organization yet. Click "Organize" to categorize files.'
            : 'This virtual folder is empty.'}
        </div>
      ) : (
        <div className="file-list">
          {isRoot
            ? // Root view: Show full tree with expand/collapse
              virtualTree.children.map((child) => renderNode(child, 0))
            : // Folder view: Show only current folder's children (like FileBrowser)
              currentNode.children.map((child) => {
                // Render as simple list items (no nesting)
                if (child.type === 'file') {
                  if (!child.fileRecord) return null;
                  const file = child.fileRecord;
                  return (
                    <div
                      key={child.id}
                      className="file-item"
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
                        <span className="file-icon">{getFileIcon(file.extension)}</span>
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
                        <span className="file-icon folder-icon">📁</span>
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
