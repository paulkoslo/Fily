import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { FileBrowser } from './components/FileBrowser';
import { VirtualTreeView } from './components/VirtualTreeView';
import { SearchInput } from './components/SearchInput';
import { Settings } from './components/Settings';
import { SettingsButton } from './components/SettingsButton';
import { MemoryInfo } from './components/MemoryInfo';
import { ContentViewer } from './components/ContentViewer';
import { ApiKeyModal } from './components/ApiKeyModal';
import { getTheme, getThemeClassName, defaultThemeId, getAllThemeIds } from './themes';

function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [pathHistory, setPathHistory] = useState<(string | null)[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentThemeId, setCurrentThemeId] = useState<string>(defaultThemeId);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [watchingSourceIds, setWatchingSourceIds] = useState<Set<number>>(new Set());
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [viewMode, setViewMode] = useState<'filesystem' | 'virtual'>('filesystem');
  const [virtualTree, setVirtualTree] = useState<VirtualNode | null>(null);
  const [currentVirtualPath, setCurrentVirtualPath] = useState<string>('/');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [contentViewerFile, setContentViewerFile] = useState<FileRecord | null>(null);
  const [contentViewerVariant, setContentViewerVariant] = useState<'full' | 'card'>('full');
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [plannerProgress, setPlannerProgress] = useState<PlannerProgress | null>(null);
  const [isManualMenuOpen, setIsManualMenuOpen] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [apiKeyModalError, setApiKeyModalError] = useState<string | null>(null);
  const [apiKeySettingsError, setApiKeySettingsError] = useState<string | null>(null);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [isApiKeyMutating, setIsApiKeyMutating] = useState(false);

  const loadSources = async () => {
    try {
      setError(null);
      const response = await window.api.getSources();
      if (response.success) {
        setSources(response.sources);
        // Auto-select first source if available and none selected
        if (response.sources.length > 0 && selectedSourceId === null) {
          setSelectedSourceId(response.sources[0].id);
        }
      } else {
        setError(response.error || 'Failed to load sources');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sources');
    }
  };

  const loadContent = useCallback(async (sourceId: number, parentPath: string | null, query?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      // If searching, search both files and folders across all directories
      if (query && query.trim()) {
        const [foldersResponse, filesResponse] = await Promise.all([
          window.api.listFolders({ sourceId, query }),
          window.api.listFiles({ sourceId, query }), // No limit - load all files
        ]);

        if (foldersResponse.success) {
          setFolders(foldersResponse.folders);
        } else {
          setFolders([]);
        }

        if (filesResponse.success) {
          setFiles(filesResponse.files);
        } else {
          setError(filesResponse.error || 'Failed to load files');
          setFiles([]);
        }
      } else {
        // Load folders and files for current path
        const [foldersResponse, filesResponse] = await Promise.all([
          window.api.listFolders({ sourceId, parentPath }),
          window.api.listFiles({ sourceId, parentPath }), // No limit - load all files
        ]);

        if (foldersResponse.success) {
          setFolders(foldersResponse.folders);
        } else {
          setError(foldersResponse.error || 'Failed to load folders');
          setFolders([]);
        }

        if (filesResponse.success) {
          setFiles(filesResponse.files);
        } else {
          setError(filesResponse.error || 'Failed to load files');
          setFiles([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content');
      setFolders([]);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, []);


  // Subscribe to scan progress updates
  useEffect(() => {
    const unsubscribe = window.api.onScanProgress((progress) => {
      setScanProgress(progress);
      if (progress.status === 'done' || progress.status === 'error') {
        // Clear progress after a short delay
        setTimeout(() => {
          setScanProgress(null);
          setIsScanning(false);
        }, 2000);
      }
    });
    return unsubscribe;
  }, []);

  // Subscribe to extraction progress updates
  useEffect(() => {
    const unsubscribe = window.api.onExtractionProgress((progress) => {
      setExtractionProgress(progress);
      if (progress.status === 'done' || progress.status === 'error') {
        setIsExtracting(false);
        // Clear progress after a short delay
        setTimeout(() => {
          setExtractionProgress(null);
        }, 2000);
      }
    });
    return unsubscribe;
  }, []);

  // Subscribe to planner progress updates
  useEffect(() => {
    const unsubscribe = window.api.onPlannerProgress((progress) => {
      setPlannerProgress(progress);
      if (progress.status === 'done' || progress.status === 'error') {
        setIsOrganizing(false);
        // Clear planner progress banner after a short delay so it doesn't stick around forever
        setTimeout(() => {
          setPlannerProgress((prev) => (prev === progress ? null : prev));
        }, 2000);
      } else {
        setIsOrganizing(true);
      }
    });
    return unsubscribe;
  }, []);

  // Load virtual tree
  const loadVirtualTree = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await window.api.getVirtualTree({
        sourceId: selectedSourceId || undefined,
      });
      if (response.success && response.tree) {
        setVirtualTree(response.tree);
      } else {
        setVirtualTree(null);
      }
    } catch (err) {
      console.error('Failed to load virtual tree:', err);
      setVirtualTree(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedSourceId]);

  // Load virtual tree when switching to virtual view
  useEffect(() => {
    if (viewMode === 'virtual') {
      loadVirtualTree();
    }
  }, [viewMode, selectedSourceId, loadVirtualTree]);

  // Subscribe to file changed events (watch mode)
  useEffect(() => {
    const unsubscribe = window.api.onFileChanged((event) => {
      console.log('[App] File changed event:', event);
      
      // Update watching source IDs if needed
      setWatchingSourceIds((prev) => {
        const next = new Set(prev);
        next.add(event.sourceId);
        return next;
      });

      // Auto-refresh file list if this is the current source (debounced)
      if (event.sourceId === selectedSourceId) {
        // Clear existing timeout
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }

        // Set new timeout to refresh after 1 second
        refreshTimeoutRef.current = setTimeout(() => {
          console.log('[App] Refreshing content due to file change');
          loadContent(selectedSourceId, currentPath, searchQuery);
        }, 1000);
      }
    });

    return () => {
      unsubscribe();
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [selectedSourceId, currentPath, searchQuery, loadContent]);

  // Load watch status on mount and when sources change
  useEffect(() => {
    const loadWatchStatus = async () => {
      try {
        const response = await window.api.getWatchStatus();
        if (response.success) {
          console.log('[App] Loaded watch status:', response.sourceIds);
          setWatchingSourceIds(new Set(response.sourceIds));
        } else {
          console.error('[App] Failed to load watch status:', response.error);
        }
      } catch (err) {
        console.error('Failed to load watch status:', err);
      }
    };
    loadWatchStatus();
  }, [sources]); // Reload when sources change

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedThemeId = localStorage.getItem('fily-theme');
    if (savedThemeId && getAllThemeIds().includes(savedThemeId)) {
      setCurrentThemeId(savedThemeId);
    }
  }, []);

  // Apply theme CSS variables and className
  useEffect(() => {
    const theme = getTheme(currentThemeId);
    const root = document.documentElement;
    const body = document.body;
    
    // Apply CSS variables
    Object.entries(theme.variables).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    
    // Apply body background for glass theme
    if (currentThemeId === 'glass' && theme.variables['--body-bg']) {
      body.style.background = theme.variables['--body-bg'];
      body.style.backgroundAttachment = 'fixed';
    } else {
      body.style.background = '';
      body.style.backgroundAttachment = '';
    }
    
    // Apply theme className to app container
    const appElement = document.querySelector('.app');
    if (appElement) {
      // Remove all theme classes
      const allThemeClasses = getAllThemeIds().map(id => getThemeClassName(id));
      appElement.classList.remove(...allThemeClasses);
      // Add current theme class
      appElement.classList.add(theme.className);
    }
    
    localStorage.setItem('fily-theme', currentThemeId);
  }, [currentThemeId]);

  // Load sources on mount
  useEffect(() => {
    loadSources();
  }, []);

  // Fetch API key status on mount
  useEffect(() => {
    const fetchApiKeyStatus = async () => {
      try {
        const status = await window.api.getApiKeyStatus();
        if (status.success) {
          setApiKeyStatus({ hasKey: status.hasKey, maskedKey: status.maskedKey });
          setIsApiKeyModalOpen(!status.hasKey);
        } else {
          setApiKeyStatus({ hasKey: false });
          setIsApiKeyModalOpen(true);
        }
      } catch (err) {
        console.error('Failed to load API key status:', err);
        setApiKeyStatus({ hasKey: false });
        setIsApiKeyModalOpen(true);
      }
    };
    fetchApiKeyStatus();
  }, []);

  // Load files and folders when source, path, or search query changes
  useEffect(() => {
    if (selectedSourceId !== null) {
      loadContent(selectedSourceId, currentPath, searchQuery);
    }
  }, [selectedSourceId, currentPath, searchQuery, loadContent]);

  const saveApiKey = useCallback(
    async (apiKey: string, target: 'modal' | 'settings'): Promise<boolean> => {
      try {
        const response = await window.api.saveApiKey({ apiKey });
        if (response.success && response.status) {
          setApiKeyStatus(response.status);
          setIsApiKeyModalOpen(false);
          setApiKeyModalError(null);
          setApiKeySettingsError(null);
          return true;
        }
        const message = response.error || 'Failed to save API key';
        if (target === 'modal') {
          setApiKeyModalError(message);
        } else {
          setApiKeySettingsError(message);
        }
        return false;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save API key';
        if (target === 'modal') {
          setApiKeyModalError(message);
        } else {
          setApiKeySettingsError(message);
        }
        return false;
      }
    },
    []
  );

  const handleModalSaveApiKey = useCallback(
    async (apiKey: string) => {
      setIsSavingApiKey(true);
      setApiKeyModalError(null);
      await saveApiKey(apiKey, 'modal');
      setIsSavingApiKey(false);
    },
    [saveApiKey]
  );

  const handleSettingsSaveApiKey = useCallback(
    async (apiKey: string) => {
      setIsApiKeyMutating(true);
      setApiKeySettingsError(null);
      const success = await saveApiKey(apiKey, 'settings');
      setIsApiKeyMutating(false);
      return success;
    },
    [saveApiKey]
  );

  const handleDeleteApiKey = useCallback(async () => {
    setIsApiKeyMutating(true);
    setApiKeySettingsError(null);
    try {
      const response = await window.api.deleteApiKey();
      if (response.success && response.status) {
        setApiKeyStatus(response.status);
        setIsApiKeyModalOpen(true);
        setApiKeyModalError(null);
        setIsApiKeyMutating(false);
        return true;
      }
      const message = response.error || 'Failed to delete API key';
      setApiKeySettingsError(message);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete API key';
      setApiKeySettingsError(message);
    } finally {
      setIsApiKeyMutating(false);
    }
    return false;
  }, []);

  const handleScan = async () => {
    if (selectedSourceId === null) return;

    setIsScanning(true);
    setScanProgress({
      status: 'scanning',
      filesFound: 0,
      foldersFound: 0,
      filesProcessed: 0,
      message: 'Starting scan...',
    });
    setError(null);

    try {
      const response = await window.api.scanSource({ sourceId: selectedSourceId });
      if (response.success) {
        // Reload content after scan
        await loadContent(selectedSourceId, currentPath, searchQuery);
      } else {
        setError(response.error || 'Scan failed');
        setScanProgress(null);
        setIsScanning(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
      setScanProgress(null);
      setIsScanning(false);
    }
  };

  const handleAddSource = async () => {
    try {
      setError(null);
      
      // Open folder selection dialog
      const folderResult = await window.api.selectFolder();
      if (!folderResult.success) {
        if (folderResult.error) {
          setError(folderResult.error);
        }
        return;
      }
      
      if (folderResult.cancelled || !folderResult.path || !folderResult.name) {
        return; // User cancelled
      }

      // Add the source
      const addResult = await window.api.addSource({
        name: folderResult.name,
        path: folderResult.path,
      });

      if (addResult.success && addResult.source) {
        // Reload sources and select the new one
        await loadSources();
        setSelectedSourceId(addResult.source.id);
        setCurrentPath(null);
        setPathHistory([]);
        
        // Update watch status to show the new source is being watched
        const watchStatus = await window.api.getWatchStatus();
        if (watchStatus.success) {
          setWatchingSourceIds(new Set(watchStatus.sourceIds));
        }
        
        // Auto-scan the new source to index existing files
        // Watch mode will handle new changes going forward
        console.log(`[App] Auto-scanning newly added source: ${addResult.source.name}`);
        setIsScanning(true);
        setScanProgress({
          status: 'scanning',
          filesFound: 0,
          foldersFound: 0,
          filesProcessed: 0,
          message: `Scanning ${addResult.source.name}...`,
        });
        
        try {
          const scanResult = await window.api.scanSource({ sourceId: addResult.source.id });
          if (scanResult.success) {
            // Reload content after scan
            await loadContent(addResult.source.id, null, '');
            console.log(`[App] Auto-scan completed: ${scanResult.filesScanned} files indexed`);
          } else {
            console.warn(`[App] Auto-scan failed: ${scanResult.error}`);
            // Don't show error to user - they can manually scan if needed
          }
        } catch (err) {
          console.error('[App] Error during auto-scan:', err);
          // Don't show error to user - they can manually scan if needed
        } finally {
          setIsScanning(false);
          setScanProgress(null);
        }
      } else {
        setError(addResult.error || 'Failed to add source');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source');
    }
  };

  const handleRemoveSource = async (sourceId: number) => {
    try {
      setError(null);
      
      const result = await window.api.removeSource({ sourceId });
      if (result.success) {
        // Reload sources
        const response = await window.api.getSources();
        if (response.success) {
          setSources(response.sources);
          // If we removed the selected source, select the first available
          if (selectedSourceId === sourceId) {
            if (response.sources.length > 0) {
              setSelectedSourceId(response.sources[0].id);
              setCurrentPath(null);
              setPathHistory([]);
            } else {
              setSelectedSourceId(null);
              setFolders([]);
              setFiles([]);
            }
          }
        }
      } else {
        setError(result.error || 'Failed to remove source');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove source');
    }
  };

  const handleFolderClick = useCallback((_folder: FolderRecord) => {
    // Single click - could be used for selection in the future
  }, []);

  const handleFolderDoubleClick = useCallback((folder: FolderRecord) => {
    // Navigate into folder
    setPathHistory((prev) => [...prev, currentPath]);
    setCurrentPath(folder.relative_path);
    setSearchQuery('');
  }, [currentPath]);

  const handleNavigateUp = useCallback(() => {
    if (pathHistory.length > 0) {
      const newHistory = [...pathHistory];
      const previousPath = newHistory.pop()!;
      setPathHistory(newHistory);
      setCurrentPath(previousPath);
    } else {
      setCurrentPath(null);
    }
  }, [pathHistory]);

  const handleFileDoubleClick = useCallback(async (file: FileRecord) => {
    try {
      const response = await window.api.openFile({ path: file.path });
      if (!response.success) {
        setError(response.error || 'Failed to open file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file');
    }
  }, []);

  const handleFileRightClick = useCallback((file: FileRecord) => {
    setContentViewerVariant('full');
    setContentViewerFile(file);
  }, []);

  const handleFileCardClick = useCallback((file: FileRecord) => {
    setContentViewerVariant('card');
    setContentViewerFile(file);
  }, []);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    // Search shows results from all directories, but we don't reset path history
    // so user can clear search and return to where they were
  }, []);

  const handleSourceSelect = useCallback((sourceId: number) => {
    setSelectedSourceId(sourceId);
    setCurrentPath(null);
    setPathHistory([]);
    setSearchQuery('');
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  const handleThemeChange = useCallback((themeId: string) => {
    setCurrentThemeId(themeId);
  }, []);

  const handleSettingsToggle = useCallback(() => {
    setIsSettingsOpen((prev) => !prev);
  }, []);

  const handleSettingsClose = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleToggleWatch = useCallback(async (sourceId: number) => {
    try {
      const isWatching = watchingSourceIds.has(sourceId);
      if (isWatching) {
        // Stop watching
        const result = await window.api.stopWatching({ sourceId });
        if (result.success) {
          setWatchingSourceIds((prev) => {
            const next = new Set(prev);
            next.delete(sourceId);
            return next;
          });
          console.log(`[App] Stopped watching source ${sourceId}`);
        }
      } else {
        // Start watching
        const result = await window.api.startWatching({ sourceId });
        if (result.success) {
          setWatchingSourceIds((prev) => {
            const next = new Set(prev);
            next.add(sourceId);
            return next;
          });
          console.log(`[App] Started watching source ${sourceId}`);
        } else {
          setError(result.error || 'Failed to start watching');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle watch');
    }
  }, [watchingSourceIds]);

  const handleExtractContent = useCallback(async () => {
    if (!selectedSourceId || isExtracting) return;

    setIsExtracting(true);
    setExtractionProgress(null);
    setError(null);

    try {
      const response = await window.api.extractContent({
        sourceId: selectedSourceId,
      });

      if (!response.success) {
        setError(response.error || 'Failed to extract content');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract content');
    } finally {
      setIsExtracting(false);
    }
  }, [selectedSourceId, isExtracting]);

  const handleOrganize = useCallback(async () => {
    if (!selectedSourceId || isOrganizing) return;

    try {
      // Check if this source already has an AI virtual organization.
      // We first look at the in-memory tree, and if that's empty or not loaded yet,
      // we ask the backend for the current tree.
      let hasExistingOrganization = false;

      if (virtualTree && virtualTree.children && virtualTree.children.length > 0) {
        hasExistingOrganization = true;
      } else {
        try {
          const existing = await window.api.getVirtualTree({ sourceId: selectedSourceId });
          if (existing.success && existing.tree && existing.tree.children && existing.tree.children.length > 0) {
            hasExistingOrganization = true;
            // Keep UI in sync with backend if we just fetched it
            setVirtualTree(existing.tree);
          }
        } catch (err) {
          console.warn('Failed to check existing virtual organization before running planner:', err);
        }
      }

      if (hasExistingOrganization) {
        const confirmed = window.confirm(
          'AI organization already exists for this source.\n\n' +
            'Running "Organize (AI Taxonomy)" again will overwrite the current virtual folder layout for these files.\n\n' +
            'Do you want to continue and re-run the AI organizer?'
        );
        if (!confirmed) {
          return;
        }
      }

      setIsOrganizing(true);
      setPlannerProgress(null);
      setError(null);

      const response = await window.api.runPlanner({
        sourceId: selectedSourceId,
      });

      if (!response.success) {
        setError(response.error || 'Failed to organize with AI taxonomy');
        setIsOrganizing(false);
      } else {
        // Reload virtual tree to reflect new placements
        await loadVirtualTree();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run AI planner');
      setIsOrganizing(false);
    }
  }, [selectedSourceId, isOrganizing, virtualTree, loadVirtualTree]);

  /**
   * Run the full AI pipeline in one click:
   * 1) Scan
   * 2) Extract Content
   * 3) Organize (AI Taxonomy)
   */
  const handleFullOrganize = useCallback(async () => {
    if (!selectedSourceId || isScanning || isExtracting || isOrganizing) return;

    // Step 1: Scan filesystem + index files
    await handleScan();

    // Step 2: Extract content (summaries, tags, etc.)
    await handleExtractContent();

    // Step 3: Run AI taxonomy planner to build virtual tree
    await handleOrganize();
  }, [
    selectedSourceId,
    isScanning,
    isExtracting,
    isOrganizing,
    handleScan,
    handleExtractContent,
    handleOrganize,
  ]);

  const handleViewModeToggle = useCallback(() => {
    const newMode = viewMode === 'filesystem' ? 'virtual' : 'filesystem';
    setViewMode(newMode);
    // Persist preference
    localStorage.setItem('fily-view-mode', newMode);
  }, [viewMode]);

  const handleVirtualPathChange = useCallback((path: string) => {
    setCurrentVirtualPath(path);
  }, []);

  const handleLoadVirtualChildren = useCallback(async (virtualPath: string): Promise<VirtualNode[]> => {
    try {
      const response = await window.api.getVirtualChildren({
        virtualPath,
        sourceId: selectedSourceId || undefined,
      });
      if (response.success) {
        return response.children;
      }
      return [];
    } catch (err) {
      console.error('Failed to load virtual children:', err);
      return [];
    }
  }, [selectedSourceId]);

  // Load view mode preference on mount
  useEffect(() => {
    const savedViewMode = localStorage.getItem('fily-view-mode');
    if (savedViewMode === 'virtual' || savedViewMode === 'filesystem') {
      setViewMode(savedViewMode);
    }
  }, []);

  return (
    <div className="app">
      <Sidebar
        sources={sources}
        selectedSourceId={selectedSourceId}
        watchingSourceIds={watchingSourceIds}
        onSourceSelect={handleSourceSelect}
        onAddSource={handleAddSource}
        onRemoveSource={handleRemoveSource}
        onToggleWatch={handleToggleWatch}
      />
      <main className="main-panel">
        <header className="toolbar">
          <SearchInput
            value={searchQuery}
            onChange={handleSearchChange}
            disabled={selectedSourceId === null || isScanning || isExtracting}
          />
          <div className="toolbar-view-toggle">
            <button
              className={`view-toggle-button ${viewMode === 'filesystem' ? 'active' : ''}`}
              onClick={handleViewModeToggle}
              disabled={isScanning || isExtracting}
              title="Filesystem View"
            >
              Filesystem
            </button>
            <button
              className={`view-toggle-button ${viewMode === 'virtual' ? 'active' : ''}`}
              onClick={handleViewModeToggle}
              disabled={isScanning || isExtracting}
              title="Virtual View"
            >
              Virtual
            </button>
          </div>
          <div className="toolbar-actions">
            <button
              className="pipeline-button"
              onClick={handleFullOrganize}
              disabled={
                selectedSourceId === null || isScanning || isExtracting || isOrganizing
              }
            >
              {isScanning || isExtracting || isOrganizing
                ? 'Running full AI organize…'
                : 'Organize (Scan → Extract → AI)'}
            </button>
            <div className="toolbar-manual">
              <button
                className="manual-button"
                disabled={
                  selectedSourceId === null || isScanning || isExtracting || isOrganizing
                }
                onClick={() => setIsManualMenuOpen((open) => !open)}
              >
                Manual ▾
              </button>
              {isManualMenuOpen && (
                <div className="manual-menu">
                  <button
                    onClick={async () => {
                      setIsManualMenuOpen(false);
                      await handleScan();
                    }}
                    disabled={
                      selectedSourceId === null ||
                      isScanning ||
                      isExtracting ||
                      isOrganizing
                    }
                  >
                    Scan only
                  </button>
                  <button
                    onClick={async () => {
                      setIsManualMenuOpen(false);
                      await handleExtractContent();
                    }}
                    disabled={
                      selectedSourceId === null ||
                      isScanning ||
                      isExtracting ||
                      isOrganizing
                    }
                  >
                    Extract Content only
                  </button>
                  <button
                    onClick={async () => {
                      setIsManualMenuOpen(false);
                      await handleOrganize();
                    }}
                    disabled={
                      selectedSourceId === null ||
                      isScanning ||
                      isExtracting ||
                      isOrganizing
                    }
                  >
                    Organize (AI Taxonomy) only
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="toolbar-right">
            <MemoryInfo />
            <SettingsButton onClick={handleSettingsToggle} isActive={isSettingsOpen} />
          </div>
        </header>

        {/* Error Banner */}
        {error && (
          <div className="error-banner">
            <span className="error-message">{error}</span>
            <button className="error-dismiss" onClick={dismissError}>
              Dismiss
            </button>
          </div>
        )}

        {/* Scan Progress */}
        {scanProgress && (
          <div className="progress-banner">
            <div className="progress-content">
              <div className="progress-status">
                <span className="progress-message">{scanProgress.message}</span>
              </div>
              {scanProgress.filesFound > 0 && scanProgress.status === 'indexing' && (
                <div className="progress-details">
                  <div className="progress-bar-container">
                    <div
                      className="progress-bar"
                      style={{
                        width: `${Math.round((scanProgress.filesProcessed / scanProgress.filesFound) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="progress-count">
                    {scanProgress.filesProcessed} / {scanProgress.filesFound}
                  </span>
                </div>
              )}
              {scanProgress.currentFile && (
                <div className="progress-current-file" title={scanProgress.currentFile}>
                  {scanProgress.currentFile}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Extraction Progress */}
        {extractionProgress && (
          <div className="progress-banner">
            <div className="progress-content">
              <div className="progress-status">
                <span className="progress-message">{extractionProgress.message}</span>
              </div>
              {extractionProgress.filesTotal > 0 && (
                <div className="progress-details">
                  <div className="progress-bar-container">
                    <div
                      className="progress-bar"
                      style={{
                        width: `${Math.round((extractionProgress.filesProcessed / extractionProgress.filesTotal) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="progress-count">
                    {extractionProgress.filesProcessed} / {extractionProgress.filesTotal}
                  </span>
                </div>
              )}
              {extractionProgress.currentFile && (
                <div className="progress-current-file" title={extractionProgress.currentFile}>
                  {extractionProgress.currentFile}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Planner Progress */}
        {plannerProgress && (
          <div className="progress-banner">
            <div className="progress-content">
              <div className="progress-status">
                <span className="progress-message">{plannerProgress.message}</span>
              </div>
              {/* For planning phase, we usually can't report granular progress – treat as indeterminate */}
              {plannerProgress.filesTotal > 0 && plannerProgress.status !== 'planning' && (
                <div className="progress-details">
                  <div className="progress-bar-container">
                    <div
                      className="progress-bar"
                      style={{
                        width: `${Math.round(
                          (plannerProgress.filesPlanned / plannerProgress.filesTotal) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <span className="progress-count">
                    {plannerProgress.filesPlanned} / {plannerProgress.filesTotal}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {viewMode === 'filesystem' ? (
          <>
            {files.length > 0 && (
              <div style={{ padding: '12px 24px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <strong>Tip:</strong> Right-click any file to view its extracted content. Click "Extract Content" to extract content from files.
              </div>
            )}
            <FileBrowser
              folders={folders}
              files={files}
              isLoading={isLoading}
              currentPath={currentPath}
              isSearching={!!searchQuery.trim()}
              onFolderClick={handleFolderClick}
              onFolderDoubleClick={handleFolderDoubleClick}
              onFileDoubleClick={handleFileDoubleClick}
              onFileRightClick={handleFileRightClick}
              onFileCardClick={handleFileCardClick}
              onNavigateUp={handleNavigateUp}
            />
          </>
        ) : (
          <VirtualTreeView
            virtualTree={virtualTree}
            isLoading={isLoading}
            currentVirtualPath={currentVirtualPath}
            onFileClick={handleFileDoubleClick}
            onFileRightClick={handleFileRightClick}
            onFileCardClick={handleFileCardClick}
            onPathChange={handleVirtualPathChange}
            onLoadChildren={handleLoadVirtualChildren}
          />
        )}

        <footer className="status-bar">
          {folders.length > 0 && `${folders.length} folder${folders.length !== 1 ? 's' : ''}, `}
          {files.length} file{files.length !== 1 ? 's' : ''}
          {searchQuery && ` matching "${searchQuery}"`}
        </footer>
      </main>
      <Settings
        isOpen={isSettingsOpen}
        currentThemeId={currentThemeId}
        onClose={handleSettingsClose}
        onThemeChange={handleThemeChange}
        apiKeyStatus={apiKeyStatus}
        apiKeyError={apiKeySettingsError}
        isApiKeyBusy={isApiKeyMutating}
        onSaveApiKey={handleSettingsSaveApiKey}
        onDeleteApiKey={handleDeleteApiKey}
      />
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        isSaving={isSavingApiKey}
        error={apiKeyModalError}
        onSubmit={handleModalSaveApiKey}
      />
      {contentViewerFile && (
        <ContentViewer
          fileId={contentViewerFile.file_id}
          fileName={contentViewerFile.name}
          filePath={contentViewerFile.relative_path ? `/${contentViewerFile.relative_path}` : contentViewerFile.path}
          isOpen={true}
          variant={contentViewerVariant}
          onClose={() => setContentViewerFile(null)}
        />
      )}
    </div>
  );
}

export default App;
