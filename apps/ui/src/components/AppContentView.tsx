import { FileBrowser } from './FileBrowser';
import { LibraryView } from './LibraryView';
import { VirtualLibraryView } from './VirtualLibraryView';
import { VirtualTreeView } from './VirtualTreeView';

interface AppContentViewProps {
  viewMode: 'filesystem' | 'virtual';
  layoutMode: 'library' | 'list';
  selectedSourceId: number | null;
  sources: Source[];
  folders: FolderRecord[];
  files: FileRecord[];
  isLoading: boolean;
  hasMoreFiles: boolean;
  isLoadingMoreFiles: boolean;
  currentPath: string | null;
  selectedFileId: string | null;
  virtualTree: VirtualNode | null;
  currentVirtualPath: string;
  onFileSelect: (fileId: string | null) => void;
  onFolderClick: (folder: FolderRecord) => void;
  onFolderDoubleClick: (folder: FolderRecord) => void;
  onFileDoubleClick: (file: FileRecord) => void;
  onFileRightClick: (file: FileRecord) => void;
  onFileCardClick: (file: FileRecord) => void;
  onNavigateUp: () => void;
  onLoadMoreFiles: () => void;
  onLibraryPathChange: (segments: string[]) => void;
  onVirtualLibraryPathChange: (segments: string[]) => void;
  onVirtualPathChange: (path: string) => void;
  onLoadVirtualChildren: (virtualPath: string) => Promise<VirtualNode[]>;
}

export function AppContentView({
  viewMode,
  layoutMode,
  selectedSourceId,
  sources,
  folders,
  files,
  isLoading,
  hasMoreFiles,
  isLoadingMoreFiles,
  currentPath,
  selectedFileId,
  virtualTree,
  currentVirtualPath,
  onFileSelect,
  onFolderClick,
  onFolderDoubleClick,
  onFileDoubleClick,
  onFileRightClick,
  onFileCardClick,
  onNavigateUp,
  onLoadMoreFiles,
  onLibraryPathChange,
  onVirtualLibraryPathChange,
  onVirtualPathChange,
  onLoadVirtualChildren,
}: AppContentViewProps) {
  if (viewMode === 'filesystem') {
    if (selectedSourceId !== null && layoutMode === 'library') {
      return (
        <LibraryView
          sourceId={selectedSourceId}
          sourceName={sources.find((s) => s.id === selectedSourceId)?.name ?? ''}
          selectedFileId={selectedFileId}
          navigateToPath={currentPath}
          onFileSelect={onFileSelect}
          onPathChange={onLibraryPathChange}
          onFileDoubleClick={onFileDoubleClick}
          onFileRightClick={onFileRightClick}
          onFileCardClick={onFileCardClick}
        />
      );
    }

    if (selectedSourceId !== null && layoutMode === 'list') {
      return (
        <>
          {files.length > 0 && (
            <div
              style={{
                padding: '12px 24px',
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-color)',
                fontSize: '12px',
                color: 'var(--text-secondary)',
              }}
            >
              <strong>Tip:</strong> Right-click any file to view its extracted content.
            </div>
          )}
          <FileBrowser
            folders={folders}
            files={files}
            isLoading={isLoading}
            hasMoreFiles={hasMoreFiles}
            isLoadingMoreFiles={isLoadingMoreFiles}
            currentPath={currentPath}
            isSearching={false}
            selectedFileId={selectedFileId}
            onFileSelect={onFileSelect}
            onFolderClick={onFolderClick}
            onFolderDoubleClick={onFolderDoubleClick}
            onFileDoubleClick={onFileDoubleClick}
            onFileRightClick={onFileRightClick}
            onFileCardClick={onFileCardClick}
            onNavigateUp={onNavigateUp}
            onLoadMoreFiles={onLoadMoreFiles}
          />
        </>
      );
    }

    return <div className="file-list-empty">Select a source folder to browse.</div>;
  }

  if (layoutMode === 'library') {
    return (
      <VirtualLibraryView
        virtualTree={virtualTree}
        isLoading={isLoading}
        selectedFileId={selectedFileId}
        navigateToPath={currentVirtualPath}
        onFileSelect={onFileSelect}
        onPathChange={onVirtualLibraryPathChange}
        onFileClick={onFileDoubleClick}
        onFileRightClick={onFileRightClick}
        onFileCardClick={onFileCardClick}
        onLoadChildren={onLoadVirtualChildren}
      />
    );
  }

  return (
    <VirtualTreeView
      virtualTree={virtualTree}
      isLoading={isLoading}
      currentVirtualPath={currentVirtualPath}
      selectedFileId={selectedFileId}
      onFileSelect={onFileSelect}
      onFileClick={onFileDoubleClick}
      onFileRightClick={onFileRightClick}
      onFileCardClick={onFileCardClick}
      onPathChange={onVirtualPathChange}
      onLoadChildren={onLoadVirtualChildren}
    />
  );
}
