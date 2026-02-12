import { useState, useEffect, useCallback, useRef } from 'react';
import { FileIcon } from './FileIcon';
import { FolderIcon } from './FolderIcon';

const DEFAULT_COLUMN_WIDTH = 220;
const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 400;

interface ColumnData {
  folders: FolderRecord[];
  files: FileRecord[];
  isLoading: boolean;
}

interface LibraryViewProps {
  sourceId: number;
  sourceName: string;
  selectedFileId?: string | null; // File ID to highlight/select (from search results)
  navigateToPath?: string | null; // Path to navigate to (from search results)
  onFileSelect?: (fileId: string | null) => void; // Callback to update selection
  onPathChange: (segments: string[]) => void;
  onFileDoubleClick: (file: FileRecord) => void;
  onFileRightClick?: (file: FileRecord) => void;
  onFileCardClick?: (file: FileRecord) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function LibraryView({
  sourceId,
  sourceName,
  selectedFileId,
  navigateToPath,
  onFileSelect,
  onPathChange,
  onFileDoubleClick,
  onFileRightClick,
  onFileCardClick,
}: LibraryViewProps) {
  // columnPaths[i] = parent path for column i; null = root
  const [columnPaths, setColumnPaths] = useState<(string | null)[]>([null]);
  const [columnWidths, setColumnWidths] = useState<number[]>([DEFAULT_COLUMN_WIDTH]);
  const [columnData, setColumnData] = useState<ColumnData[]>([{ folders: [], files: [], isLoading: true }]);
  const [selectedFolderInColumn, setSelectedFolderInColumn] = useState<(string | null)[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ columnIndex: number; startX: number; startWidth: number } | null>(null);
  const selectedFileRef = useRef<HTMLDivElement | null>(null);

  const loadColumn = useCallback(async (parentPath: string | null) => {
    try {
      const [foldersRes, filesRes] = await Promise.all([
        window.api.listFolders({ sourceId, parentPath }),
        window.api.listFiles({ sourceId, parentPath }),
      ]);
      return {
        folders: foldersRes.success ? foldersRes.folders : [],
        files: filesRes.success ? filesRes.files : [],
        isLoading: false,
      };
    } catch {
      return { folders: [], files: [], isLoading: false };
    }
  }, [sourceId]);

  // Load data for each column when columnPaths changes
  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      const data: ColumnData[] = [];
      for (let i = 0; i < columnPaths.length; i++) {
        data.push({ folders: [], files: [], isLoading: true });
        setColumnData([...data]);
      }
      for (let i = 0; i < columnPaths.length; i++) {
        if (cancelled) return;
        const result = await loadColumn(columnPaths[i]);
        if (cancelled) return;
        data[i] = result;
        setColumnData([...data]);
      }
    };
    loadAll();
    return () => { cancelled = true; };
  }, [JSON.stringify(columnPaths), sourceId, loadColumn]);

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

  // Reset when source changes
  useEffect(() => {
    setColumnPaths([null]);
    setColumnWidths([DEFAULT_COLUMN_WIDTH]);
    setSelectedFolderInColumn([]);
    setSelectedFile(null);
  }, [sourceId]);

  // Navigate to path when navigateToPath changes (from search results)
  useEffect(() => {
    if (navigateToPath === undefined) return; // undefined = not set, null = root
    
    // Build column paths from navigateToPath
    // navigateToPath is like "folder1/folder2" or null for root
    if (navigateToPath === null) {
      // Navigate to root
      setColumnPaths([null]);
      setSelectedFolderInColumn([]);
      return;
    }

    // Split path into segments and build column structure
    const pathSegments = navigateToPath.split('/').filter(p => p.length > 0);
    const newPaths: (string | null)[] = [null]; // Start with root
    const newSelections: (string | null)[] = [];

    // Build up columns for each path segment
    for (let i = 0; i < pathSegments.length; i++) {
      const segment = pathSegments[i];
      const currentPath = pathSegments.slice(0, i + 1).join('/');
      newPaths.push(currentPath);
      newSelections.push(segment);
    }

    setColumnPaths(newPaths);
    setSelectedFolderInColumn(newSelections);
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
      const file = columnData[lastColumnIndex]?.files.find(f => f.file_id === selectedFileId);
      if (file) {
        setSelectedFile(file);
        // Scroll to file after a small delay to ensure DOM is updated
        setTimeout(() => {
          if (selectedFileRef.current) {
            selectedFileRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 200);
      }
    }
  }, [selectedFileId, columnData]);

  // Resize handling
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

  // Report path to parent
  useEffect(() => {
    const segments = [sourceName];
    for (let i = 0; i < selectedFolderInColumn.length; i++) {
      if (selectedFolderInColumn[i]) {
        segments.push(selectedFolderInColumn[i]!);
      }
    }
    if (selectedFile) {
      segments.push(selectedFile.name);
    }
    onPathChange(segments);
  }, [sourceName, selectedFolderInColumn, selectedFile, onPathChange]);

  const handleFolderSelect = useCallback((columnIndex: number, folder: FolderRecord, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent library view click
    const newPaths = columnPaths.slice(0, columnIndex + 1);
    newPaths.push(folder.relative_path);
    setColumnPaths(newPaths);

    const newSelection = selectedFolderInColumn.slice(0, columnIndex);
    newSelection.push(folder.name);
    setSelectedFolderInColumn(newSelection);
    setSelectedFile(null);
    // Clear selection when clicking folder
    if (onFileSelect) {
      onFileSelect(null);
    }
  }, [columnPaths, selectedFolderInColumn, onFileSelect]);

  const handleFileSelect = useCallback((file: FileRecord, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent library view click from clearing selection
    setSelectedFile(file);
    // Notify parent component of selection
    if (onFileSelect) {
      onFileSelect(file.file_id);
    }
  }, [onFileSelect]);

  const handleFileDoubleClick = useCallback((file: FileRecord) => {
    onFileDoubleClick(file);
  }, [onFileDoubleClick]);

  const handleFileRightClick = useCallback((file: FileRecord, e: React.MouseEvent) => {
    e.preventDefault();
    if (onFileRightClick) onFileRightClick(file);
  }, [onFileRightClick]);

  const handleLibraryViewClick = useCallback((e: React.MouseEvent) => {
    // Clear selection when clicking anywhere in library view (not on a file/folder)
    const target = e.target as HTMLElement;
    if (target.classList.contains('library-view') || target.classList.contains('library-column-content')) {
      if (onFileSelect) {
        onFileSelect(null);
      }
    }
  }, [onFileSelect]);

  return (
    <div className="library-view" onClick={handleLibraryViewClick}>
      {columnPaths.map((_, colIndex) => {
        const data = columnData[colIndex] || { folders: [], files: [], isLoading: false };
        const selectedFolderName = selectedFolderInColumn[colIndex];
        const isLast = colIndex === columnPaths.length - 1;
        const width = columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTH;
        return (
          <div key={colIndex} className="library-column-wrapper">
            <div
              className={`library-column ${isLast ? 'library-column-last' : ''}`}
              style={isLast ? undefined : { width: width, minWidth: width, maxWidth: width }}
            >
              <div className="library-column-content">
              {data.isLoading ? (
                <div className="library-column-loading">Loading...</div>
              ) : data.folders.length === 0 && data.files.length === 0 ? (
                <div className="library-column-empty">Empty</div>
              ) : (
                <>
                  {data.folders.map((folder) => (
                    <div
                      key={folder.folder_id}
                      className={`library-item folder-item ${selectedFolderName === folder.name ? 'selected' : ''}`}
                      onClick={(e) => handleFolderSelect(colIndex, folder, e)}
                    >
                      <FolderIcon />
                      <span className="library-item-name">{folder.name}</span>
                    </div>
                  ))}
                  {data.files.map((file) => {
                    const isSelected = selectedFile?.file_id === file.file_id || selectedFileId === file.file_id;
                    return (
                    <div
                      key={file.file_id}
                      ref={isSelected ? selectedFileRef : null}
                      className={`library-item file-item ${isSelected ? 'selected' : ''}`}
                      onClick={(e) => handleFileSelect(file, e)}
                      onDoubleClick={() => handleFileDoubleClick(file)}
                      onContextMenu={(e) => handleFileRightClick(file, e)}
                    >
                      <FileIcon extension={file.extension || ''} />
                      <div className="library-item-file-info">
                        <span className="library-item-name">{file.name}</span>
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
