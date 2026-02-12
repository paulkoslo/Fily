import { useState, useEffect, useCallback, useRef } from 'react';
import { FileIcon } from './FileIcon';
import { FolderIcon } from './FolderIcon';

const DEFAULT_COLUMN_WIDTH = 220;
const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 400;

interface VirtualLibraryViewProps {
  virtualTree: VirtualNode | null;
  isLoading: boolean;
  selectedFileId?: string | null; // File ID to highlight/select (from search results)
  navigateToPath?: string | null; // Virtual path to navigate to (from search results)
  onFileSelect?: (fileId: string | null) => void; // Callback to update selection
  onPathChange: (segments: string[]) => void;
  onFileClick: (file: FileRecord) => void;
  onFileRightClick?: (file: FileRecord) => void;
  onFileCardClick?: (file: FileRecord) => void;
  onLoadChildren?: (virtualPath: string) => Promise<VirtualNode[]>;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function VirtualLibraryView({
  virtualTree,
  isLoading,
  selectedFileId,
  navigateToPath,
  onFileSelect,
  onPathChange,
  onFileClick,
  onFileRightClick,
  onFileCardClick,
  onLoadChildren,
}: VirtualLibraryViewProps) {
  // columnPaths[i] = path for column i; '/' = root
  const [columnPaths, setColumnPaths] = useState<string[]>(['/']);
  const [columnWidths, setColumnWidths] = useState<number[]>([DEFAULT_COLUMN_WIDTH]);
  const [columnData, setColumnData] = useState<VirtualNode[][]>([]);
  const [loadingColumns, setLoadingColumns] = useState<Set<number>>(new Set());
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ columnIndex: number; startX: number; startWidth: number } | null>(null);
  const selectedFileRef = useRef<HTMLDivElement | null>(null);

  // Sync columnWidths when columnPaths changes
  useEffect(() => {
    setColumnWidths((prev) => {
      const target = columnPaths.length;
      if (prev.length === target) return prev;
      if (prev.length < target) {
        return [...prev, ...Array(target - prev.length).fill(DEFAULT_COLUMN_WIDTH)];
      }
      return prev.slice(0, target);
    });
  }, [columnPaths.length]);

  // Reset when tree is replaced (e.g. after re-organize)
  useEffect(() => {
    setColumnPaths(['/']);
    setColumnWidths([DEFAULT_COLUMN_WIDTH]);
    setSelectedFile(null);
  }, [virtualTree]);

  // Navigate to path when navigateToPath changes (from search results)
  useEffect(() => {
    if (navigateToPath === undefined) return; // undefined = not set
    
    // navigateToPath is like "/folder1/folder2" or "/" for root
    if (navigateToPath === '/' || navigateToPath === null) {
      setColumnPaths(['/']);
      return;
    }

    // Split path into segments and build column structure
    const pathSegments = navigateToPath.split('/').filter(p => p.length > 0);
    const newPaths: string[] = ['/']; // Start with root

    // Build up columns for each path segment
    for (let i = 0; i < pathSegments.length; i++) {
      const currentPath = '/' + pathSegments.slice(0, i + 1).join('/');
      newPaths.push(currentPath);
    }

    setColumnPaths(newPaths);
  }, [navigateToPath]);

  // Navigate to file when selectedFileId changes (from search results)
  useEffect(() => {
    if (!selectedFileId) {
      setSelectedFile(null);
      return;
    }

    // Find the file in the last column (where files should be)
    const lastColumnIndex = columnData.length - 1;
    if (lastColumnIndex >= 0) {
      const column = columnData[lastColumnIndex];
      if (column) {
        for (const node of column) {
          if (node.type === 'file' && node.fileRecord?.file_id === selectedFileId) {
            setSelectedFile(node.fileRecord);
            // Scroll to file after a small delay to ensure DOM is updated
            setTimeout(() => {
              if (selectedFileRef.current) {
                selectedFileRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 200);
            break;
          }
        }
      }
    }
  }, [selectedFileId, columnData]);

  const handleResizeStart = useCallback((columnIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = {
      columnIndex,
      startX: e.clientX,
      startWidth: columnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH,
    };
  }, [columnWidths]);

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const delta = e.clientX - r.startX;
      const newWidth = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, r.startWidth + delta));
      setColumnWidths((prev) => {
        const next = [...prev];
        next[r.columnIndex] = newWidth;
        return next;
      });
    };
    const onMouseUp = () => {
      resizeRef.current = null;
      setIsResizing(false);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const getChildrenForPath = useCallback(
    async (path: string): Promise<VirtualNode[]> => {
      if (!virtualTree) return [];
      if (path === '/') return virtualTree.children || [];
      if (onLoadChildren) return onLoadChildren(path);

      // Fallback: find in tree
      const findNode = (node: VirtualNode, p: string): VirtualNode | null => {
        if (node.path === p) return node;
        for (const child of node.children) {
          const found = findNode(child, p);
          if (found) return found;
        }
        return null;
      };
      const node = findNode(virtualTree, path);
      return node?.children ?? [];
    },
    [virtualTree, onLoadChildren]
  );

  useEffect(() => {
    if (!virtualTree) return;
    let cancelled = false;

    const loadAll = async () => {
      const data: VirtualNode[][] = [];
      for (let i = 0; i < columnPaths.length; i++) {
        setLoadingColumns((prev) => new Set(prev).add(i));
      }
      for (let i = 0; i < columnPaths.length; i++) {
        if (cancelled) return;
        const children = await getChildrenForPath(columnPaths[i]);
        if (cancelled) return;
        data.push(children);
        setColumnData([...data]);
        setLoadingColumns((prev) => {
          const next = new Set(prev);
          next.delete(i);
          return next;
        });
      }
    };
    loadAll();
    return () => { cancelled = true; };
  }, [JSON.stringify(columnPaths), virtualTree, getChildrenForPath]);

  useEffect(() => {
    const segments = columnPaths.slice(1).map((p) => p.split('/').pop() ?? '');
    if (selectedFile) {
      segments.push(selectedFile.name);
    }
    onPathChange(['Virtual', ...segments]);
  }, [columnPaths, selectedFile, onPathChange]);

  const handleFolderSelect = useCallback((columnIndex: number, node: VirtualNode, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent library view click
    // Clear selection when clicking folder
    if (onFileSelect) {
      onFileSelect(null);
    }
    // Navigate to folder (existing logic)
    const newPaths = columnPaths.slice(0, columnIndex + 1);
    newPaths.push(node.path);
    setColumnPaths(newPaths);
    setSelectedFile(null);
  }, [onFileSelect, columnPaths]);

  const handleFileSelect = useCallback((file: FileRecord, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent library view click from clearing selection
    setSelectedFile(file);
    // Notify parent component of selection
    if (onFileSelect) {
      onFileSelect(file.file_id);
    }
  }, [onFileSelect]);

  const handleLibraryViewClick = useCallback((e: React.MouseEvent) => {
    // Clear selection when clicking anywhere in library view (not on a file/folder)
    const target = e.target as HTMLElement;
    if (target.classList.contains('library-view') || target.classList.contains('library-column-content')) {
      if (onFileSelect) {
        onFileSelect(null);
      }
    }
  }, [onFileSelect]);

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
          No virtual organization yet. Switch to "Filesystem" view, then click "Organize" to categorize files.
        </div>
      </div>
    );
  }

  return (
    <div className="library-view" onClick={handleLibraryViewClick}>
      {columnPaths.map((_, colIndex) => {
        const isLoadingCol = loadingColumns.has(colIndex);
        const nodes = columnData[colIndex] ?? [];
        const isLast = colIndex === columnPaths.length - 1;
        const width = columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTH;

        return (
          <div key={colIndex} className="library-column-wrapper">
            <div
              className={`library-column ${isLast ? 'library-column-last' : ''}`}
              style={isLast ? undefined : { width: width, minWidth: width, maxWidth: width }}
            >
              <div className="library-column-content">
              {isLoadingCol ? (
                <div className="library-column-loading">Loading...</div>
              ) : nodes.length === 0 ? (
                <div className="library-column-empty">Empty</div>
              ) : (
                <>
                  {nodes
                    .filter((n) => n.type === 'folder')
                    .map((node) => (
                      <div
                        key={node.id}
                        className={`library-item folder-item ${columnPaths[colIndex + 1] === node.path ? 'selected' : ''}`}
                        onClick={(e) => handleFolderSelect(colIndex, node, e)}
                      >
                        <FolderIcon />
                        <span className="library-item-name">{node.name}</span>
                      </div>
                    ))}
                  {nodes
                    .filter((n) => n.type === 'file')
                    .map((node) => {
                      if (!node.fileRecord) return null;
                      const file = node.fileRecord;
                      return (
                        <div
                          key={node.id}
                          className={`library-item file-item ${selectedFile?.file_id === node.fileRecord?.file_id || selectedFileId === node.fileRecord?.file_id ? 'selected' : ''}`}
                          ref={(selectedFile?.file_id === node.fileRecord?.file_id || selectedFileId === node.fileRecord?.file_id) ? selectedFileRef : null}
                          onClick={(e) => handleFileSelect(file, e)}
                          onDoubleClick={() => onFileClick(file)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (onFileRightClick) onFileRightClick(file);
                          }}
                        >
                          <FileIcon extension={file.extension || ''} />
                          <div className="library-item-file-info">
                            <span className="library-item-name">{node.name}</span>
                            <span className="library-item-meta">{formatFileSize(file.size)}</span>
                          </div>
                          <span
                            className="file-content-indicator"
                            title="View details"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onFileCardClick) onFileCardClick(file);
                              else if (onFileRightClick) onFileRightClick(file);
                            }}
                          >
                            ℹ️
                          </span>
                        </div>
                      );
                    })}
                </>
              )}
            </div>
            </div>
            {colIndex < columnPaths.length - 1 && (
              <div
                className="library-column-resize-handle"
                onMouseDown={(e) => handleResizeStart(colIndex, e)}
                title="Drag to resize"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
