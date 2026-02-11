import { memo, useCallback } from 'react';
import { FileIcon } from './FileIcon';

interface FileListProps {
  files: FileRecord[];
  isLoading: boolean;
  onFileDoubleClick: (file: FileRecord) => void;
  onFileRightClick?: (file: FileRecord) => void;
}

export const FileList = memo(function FileList({
  files,
  isLoading,
  onFileDoubleClick,
  onFileRightClick,
}: FileListProps) {
  if (isLoading) {
    return (
      <div className="file-list-container">
        <div className="file-list-loading">Loading files...</div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="file-list-container">
        <div className="file-list-empty">
          No files found. Click "Scan" to index files.
        </div>
      </div>
    );
  }

  return (
    <div className="file-list-container">
      <div className="file-list">
        {files.map((file) => (
          <FileItem
            key={file.file_id}
            file={file}
            onDoubleClick={onFileDoubleClick}
            onRightClick={onFileRightClick}
          />
        ))}
      </div>
    </div>
  );
});

interface FileItemProps {
  file: FileRecord;
  onDoubleClick: (file: FileRecord) => void;
  onRightClick?: (file: FileRecord) => void;
}

const FileItem = memo(function FileItem({ file, onDoubleClick, onRightClick }: FileItemProps) {
  const handleDoubleClick = useCallback(() => {
    onDoubleClick(file);
  }, [file, onDoubleClick]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (onRightClick) {
      onRightClick(file);
    }
  }, [file, onRightClick]);

  return (
    <div 
      className="file-item" 
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <div className="file-name">
        <FileIcon extension={file.extension} />
        <span className="file-name-text">{file.name}</span>
      </div>
      <span className="file-extension">{file.extension || '—'}</span>
      <span className="file-size">{formatFileSize(file.size)}</span>
      <span className="file-date">{formatDate(file.mtime)}</span>
    </div>
  );
});

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);

  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
