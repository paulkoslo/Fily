import { useCallback, useEffect, useRef } from 'react';
import { FileIcon } from './FileIcon';
import { FolderIcon } from './FolderIcon';

interface FileBrowserProps {
  folders: FolderRecord[];
  files: FileRecord[];
  isLoading: boolean;
  currentPath: string | null;
  isSearching: boolean;
  selectedFileId?: string | null; // File ID to highlight/select
  onFileSelect?: (fileId: string | null) => void; // Callback to update selection
  onFolderClick: (folder: FolderRecord) => void;
  onFolderDoubleClick: (folder: FolderRecord) => void;
  onFileDoubleClick: (file: FileRecord) => void;
  onFileRightClick?: (file: FileRecord) => void;
  onFileCardClick?: (file: FileRecord) => void;
  onNavigateUp: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function FileBrowser({
  folders,
  files,
  isLoading,
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
}: FileBrowserProps) {
  const handleFolderDoubleClick = useCallback(
    (folder: FolderRecord) => {
      onFolderDoubleClick(folder);
    },
    [onFolderDoubleClick]
  );

  const handleFileDoubleClick = useCallback(
    (file: FileRecord) => {
      onFileDoubleClick(file);
    },
    [onFileDoubleClick]
  );

  const handleFileRightClick = useCallback(
    (file: FileRecord, e: React.MouseEvent) => {
      e.preventDefault();
      if (onFileRightClick) {
        onFileRightClick(file);
      }
    },
    [onFileRightClick]
  );

  // Scroll to selected file when it becomes visible (wait for files to load)
  const selectedFileRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selectedFileId && selectedFileRef.current && !isLoading && files.length > 0) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        if (selectedFileRef.current) {
          selectedFileRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [selectedFileId, isLoading, files.length]);

  if (isLoading) {
    return (
      <div className="file-list-container">
        <div className="file-list-loading">Loading...</div>
      </div>
    );
  }

  const isEmpty = folders.length === 0 && files.length === 0;

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

  const handleFolderClickWrapper = useCallback((folder: FolderRecord, e: React.MouseEvent) => {
    // Clear selection when clicking a folder
    e.stopPropagation(); // Prevent container click
    if (onFileSelect) {
      onFileSelect(null);
    }
    onFolderClick(folder);
  }, [onFileSelect, onFolderClick]);

  return (
    <div className="file-list-container" onClick={handleContainerClick}>
      {/* Breadcrumb / Navigate Up */}
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
        <div className="file-list" onClick={handleContainerClick}>
          {/* Folders first */}
          {folders.map((folder) => (
            <div
              key={folder.folder_id}
              className="file-item folder-item"
              onClick={(e) => handleFolderClickWrapper(folder, e)}
              onDoubleClick={() => handleFolderDoubleClick(folder)}
              title={`${folder.path}\n${folder.item_count} items`}
            >
              <div className="file-name">
                <FolderIcon />
                <div className="file-name-content">
                  <span className="file-name-text">{folder.name}</span>
                  {isSearching && folder.parent_path && (
                    <span className="file-path-hint">in /{folder.parent_path}</span>
                  )}
                </div>
              </div>
              <div className="file-extension">Folder</div>
              <div className="file-size">{folder.item_count} items</div>
              <div className="file-date">{formatDate(folder.mtime)}</div>
            </div>
          ))}

          {/* Files */}
          {files.map((file) => (
            <div
              key={file.file_id}
              className={`file-item ${selectedFileId === file.file_id ? 'selected' : ''}`}
              ref={selectedFileId === file.file_id ? selectedFileRef : null}
              onClick={(e) => handleFileClick(file, e)}
              onDoubleClick={() => handleFileDoubleClick(file)}
              onContextMenu={(e) => handleFileRightClick(file, e)}
              title={`${file.path}\nRight-click to view extracted content`}
            >
              <div className="file-name">
                <FileIcon extension={file.extension || ''} />
                <div className="file-name-content">
                  <span className="file-name-text">{file.name}</span>
                  {isSearching && file.parent_path && (
                    <span className="file-path-hint">in /{file.parent_path}</span>
                  )}
                </div>
                <span
                  className="file-content-indicator"
                  title="Click to view file card (or right-click row for full details)"
                  onClick={(e) => {
                    // Prevent double-click/open behaviour when clicking the icon
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
              <div className="file-date">{formatDate(file.mtime)}</div>
            </div>
          ))}

          {/* File count indicator */}
          {files.length > 0 && (
            <div className="file-list-end">
              Showing {files.length.toLocaleString()} file{files.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
