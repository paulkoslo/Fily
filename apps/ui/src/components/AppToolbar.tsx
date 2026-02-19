import { SearchBar } from './SearchBar';
import { SettingsButton } from './SettingsButton';

interface AppToolbarProps {
  viewMode: 'filesystem' | 'virtual';
  layoutMode: 'library' | 'list';
  isLayoutMenuOpen: boolean;
  isManualMenuOpen: boolean;
  selectedSourceId: number | null;
  searchInput: string;
  isSettingsOpen: boolean;
  isScanning: boolean;
  isExtracting: boolean;
  isOrganizing: boolean;
  isOptimizing: boolean;
  onViewModeToggle: () => void;
  onToggleLayoutMenu: () => void;
  onLayoutModeChange: (mode: 'library' | 'list') => void;
  onCloseLayoutMenu: () => void;
  onSearchChange: (query: string) => void;
  onSearchResultSelect: (result: SmartSearchResult) => void | Promise<void>;
  onFullOrganize: () => void | Promise<void>;
  onToggleManualMenu: () => void;
  onCloseManualMenu: () => void;
  onScanOnly: () => void | Promise<void>;
  onExtractOnly: () => void | Promise<unknown>;
  onOrganizeOnly: () => void | Promise<void>;
  onOptimizeOnly: () => void | Promise<void>;
  onSettingsToggle: () => void;
}

export function AppToolbar({
  viewMode,
  layoutMode,
  isLayoutMenuOpen,
  isManualMenuOpen,
  selectedSourceId,
  searchInput,
  isSettingsOpen,
  isScanning,
  isExtracting,
  isOrganizing,
  isOptimizing,
  onViewModeToggle,
  onToggleLayoutMenu,
  onLayoutModeChange,
  onCloseLayoutMenu,
  onSearchChange,
  onSearchResultSelect,
  onFullOrganize,
  onToggleManualMenu,
  onCloseManualMenu,
  onScanOnly,
  onExtractOnly,
  onOrganizeOnly,
  onOptimizeOnly,
  onSettingsToggle,
}: AppToolbarProps) {
  const pipelineBusy = isScanning || isExtracting || isOrganizing;
  const manualBusy = pipelineBusy || isOptimizing;

  return (
    <header className="toolbar">
      <div className="toolbar-view-toggle">
        <button
          className={`view-toggle-button ${viewMode === 'filesystem' ? 'active' : ''}`}
          onClick={onViewModeToggle}
          disabled={isScanning || isExtracting}
          title="Filesystem View"
        >
          Filesystem
        </button>
        <button
          className={`view-toggle-button ${viewMode === 'virtual' ? 'active' : ''}`}
          onClick={onViewModeToggle}
          disabled={isScanning || isExtracting}
          title="Virtual View"
        >
          Virtual
        </button>
      </div>

      <div className="toolbar-layout-dropdown" onClick={(e) => e.stopPropagation()}>
        <button
          className="layout-dropdown-button"
          onClick={onToggleLayoutMenu}
          title={layoutMode === 'library' ? 'Column view' : 'List view'}
        >
          {layoutMode === 'library' ? (
            <svg className="layout-icon" width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
              <rect x="1" y="2" width="2" height="10" rx="0.5" />
              <rect x="6" y="2" width="2" height="10" rx="0.5" />
              <rect x="11" y="2" width="2" height="10" rx="0.5" />
            </svg>
          ) : (
            <svg className="layout-icon" width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
              <rect x="2" y="2" width="10" height="2" rx="0.5" />
              <rect x="2" y="6" width="10" height="2" rx="0.5" />
              <rect x="2" y="10" width="10" height="2" rx="0.5" />
            </svg>
          )}
          <span className="layout-dropdown-arrow">▾</span>
        </button>

        {isLayoutMenuOpen && (
          <div className="layout-dropdown-menu">
            <button
              onClick={() => {
                onLayoutModeChange('library');
                onCloseLayoutMenu();
              }}
              className={layoutMode === 'library' ? 'selected' : ''}
              title="Column view"
            >
              <svg className="layout-icon" width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
                <rect x="1" y="2" width="2" height="10" rx="0.5" />
                <rect x="6" y="2" width="2" height="10" rx="0.5" />
                <rect x="11" y="2" width="2" height="10" rx="0.5" />
              </svg>
            </button>
            <button
              onClick={() => {
                onLayoutModeChange('list');
                onCloseLayoutMenu();
              }}
              className={layoutMode === 'list' ? 'selected' : ''}
              title="List view"
            >
              <svg className="layout-icon" width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
                <rect x="2" y="2" width="10" height="2" rx="0.5" />
                <rect x="2" y="6" width="10" height="2" rx="0.5" />
                <rect x="2" y="10" width="10" height="2" rx="0.5" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <SearchBar
        value={searchInput}
        onChange={onSearchChange}
        onResultSelect={onSearchResultSelect}
        disabled={selectedSourceId === null || isScanning || isExtracting}
        sourceId={selectedSourceId}
      />

      <div className="toolbar-actions">
        <button
          className="pipeline-button"
          onClick={onFullOrganize}
          disabled={selectedSourceId === null || pipelineBusy}
        >
          {pipelineBusy ? 'Organizing…' : 'Organize'}
        </button>

        <div className="toolbar-manual">
          <button
            className="manual-button"
            disabled={selectedSourceId === null || manualBusy}
            onClick={onToggleManualMenu}
          >
            Manual ▾
          </button>

          {isManualMenuOpen && (
            <div className="manual-menu">
              <button
                onClick={async () => {
                  onCloseManualMenu();
                  await onScanOnly();
                }}
                disabled={selectedSourceId === null || pipelineBusy}
              >
                Scan only
              </button>
              <button
                onClick={async () => {
                  onCloseManualMenu();
                  await onExtractOnly();
                }}
                disabled={selectedSourceId === null || pipelineBusy}
              >
                Extract Content only
              </button>
              <button
                onClick={async () => {
                  onCloseManualMenu();
                  await onOrganizeOnly();
                }}
                disabled={selectedSourceId === null || manualBusy}
              >
                Organize (AI Taxonomy) only
              </button>
              <button
                onClick={async () => {
                  onCloseManualMenu();
                  await onOptimizeOnly();
                }}
                disabled={selectedSourceId === null || manualBusy}
              >
                Optimize only
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-right">
        <SettingsButton onClick={onSettingsToggle} isActive={isSettingsOpen} />
      </div>
    </header>
  );
}
