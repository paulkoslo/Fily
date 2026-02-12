import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { FileBrowser } from './components/FileBrowser';
import { LibraryView } from './components/LibraryView';
import { VirtualLibraryView } from './components/VirtualLibraryView';
import { VirtualTreeView } from './components/VirtualTreeView';
import { SearchBar } from './components/SearchBar';
import { Settings } from './components/Settings';
import { SettingsButton } from './components/SettingsButton';
import { MemoryInfo } from './components/MemoryInfo';
import { ContentViewer } from './components/ContentViewer';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ProgressBar } from './components/ProgressBar';
import { getTheme, getThemeClassName, defaultThemeId, getAllThemeIds } from './themes';

function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [pathHistory, setPathHistory] = useState<(string | null)[]>([]);
  const [searchInput, setSearchInput] = useState(''); // Search input (independent from file viewer)
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentThemeId, setCurrentThemeId] = useState<string>(defaultThemeId);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [watchingSourceIds, setWatchingSourceIds] = useState<Set<number>>(new Set());
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [viewMode, setViewMode] = useState<'filesystem' | 'virtual'>('filesystem');
  const [layoutMode, setLayoutMode] = useState<'library' | 'list'>('library');
  const [virtualTree, setVirtualTree] = useState<VirtualNode | null>(null);
  const [currentVirtualPath, setCurrentVirtualPath] = useState<string>('/');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [contentViewerFile, setContentViewerFile] = useState<FileRecord | null>(null);
  const [contentViewerVariant, setContentViewerVariant] = useState<'full' | 'card'>('full');
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [plannerProgress, setPlannerProgress] = useState<PlannerProgress | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizerProgress, setOptimizerProgress] = useState<OptimizerProgress | null>(null);
  // Ref to track latest extraction progress for synchronous access in callbacks
  const extractionProgressRef = useRef<ExtractionProgress | null>(null);
  const [isManualMenuOpen, setIsManualMenuOpen] = useState(false);
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [apiKeyModalError, setApiKeyModalError] = useState<string | null>(null);
  const [apiKeySettingsError, setApiKeySettingsError] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<LLMModel | null>(null);
  const [isModelBusy, setIsModelBusy] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [isApiKeyMutating, setIsApiKeyMutating] = useState(false);
  const [statusBarPath, setStatusBarPath] = useState<string[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null); // Selected file for future selection/moving features

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
      // Use requestAnimationFrame to ensure UI updates are rendered
      requestAnimationFrame(() => {
        setExtractionProgress(progress);
        extractionProgressRef.current = progress; // Update ref synchronously
        if (progress.status === 'done') {
          setIsExtracting(false);
          // Show completion animation, then clear progress
          setTimeout(() => {
            setExtractionProgress((prev) => prev ? { ...prev, status: 'done' as const } : null);
            setTimeout(() => {
              setExtractionProgress(null);
              extractionProgressRef.current = null;
            }, 1000); // Fade out after animation
          }, 500); // Show completion state briefly
        } else if (progress.status === 'error') {
          // On error, keep progress bar visible but mark extraction as done
          // This allows taxonomy to proceed even if some batches failed
          setIsExtracting(false);
          // Don't clear progress immediately - keep it visible so user sees what happened
          // Progress will be cleared when extraction completes (even with errors)
        }
      });
    });
    return unsubscribe;
  }, []);

  // Subscribe to planner progress updates
  useEffect(() => {
    const unsubscribe = window.api.onPlannerProgress((progress) => {
      setPlannerProgress(progress);
      if (progress.status === 'done' || progress.status === 'error') {
        setIsOrganizing(false);
        // Show completion animation, then clear progress
        setTimeout(() => {
          setPlannerProgress((prev) => prev ? { ...prev, status: 'done' as const } : null);
          setTimeout(() => {
            setPlannerProgress(null);
          }, 1000); // Fade out after animation
        }, 500); // Show completion state briefly
      } else {
        setIsOrganizing(true);
      }
    });
    return unsubscribe;
  }, []);

  // Subscribe to optimizer progress updates
  useEffect(() => {
    const unsubscribeOptimizer = window.api.onOptimizerProgress((progress) => {
      setOptimizerProgress(progress);
      if (progress.status === 'done' || progress.status === 'error') {
        setIsOptimizing(false);
        if (progress.status === 'done') {
          setTimeout(() => {
            setOptimizerProgress(null);
          }, 2000);
        }
      } else {
        setIsOptimizing(true);
      }
    });
    return unsubscribeOptimizer;
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
          loadContent(selectedSourceId, currentPath);
        }, 1000);
      }
    });

    return () => {
      unsubscribe();
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [selectedSourceId, currentPath, loadContent]);

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

  // Load theme from localStorage on mount (migrate old theme IDs to light/dark)
  useEffect(() => {
    const savedThemeId = localStorage.getItem('fily-theme');
    const validIds = getAllThemeIds();
    if (savedThemeId && validIds.includes(savedThemeId)) {
      setCurrentThemeId(savedThemeId);
    } else if (savedThemeId) {
      // Migrate legacy themes: dark-modern, glass, bold, fluid, neon → dark; minimal → light
      const darkLegacy = ['dark-modern', 'glass', 'bold', 'fluid', 'neon'];
      setCurrentThemeId(darkLegacy.includes(savedThemeId) ? 'dark' : 'light');
    }
  }, []);

  // Apply theme CSS variables and className
  useEffect(() => {
    const theme = getTheme(currentThemeId);
    const root = document.documentElement;

    // Apply CSS variables
    Object.entries(theme.variables).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    
    
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

  // Fetch API key status and model on mount
  useEffect(() => {
    const fetchApiKeyStatus = async () => {
      try {
        const status = await window.api.getApiKeyStatus();
        if (status.success) {
          setApiKeyStatus({ hasKey: status.hasKey, maskedKey: status.maskedKey, provider: status.provider });
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

    const fetchModel = async () => {
      try {
        const response = await window.api.getLLMModel();
        if (response.success && response.model) {
          setCurrentModel(response.model);
        }
      } catch (err) {
        console.error('Failed to load LLM model:', err);
      }
    };

    fetchApiKeyStatus();
    fetchModel();
  }, []);

  // Load files and folders when source or path changes (NOT when search input changes)
  // NOTE: This useEffect handles normal navigation. Search result clicks explicitly call loadContent
  // and set selectedFileId, so we don't clear selection here to avoid race conditions.
  useEffect(() => {
    if (selectedSourceId !== null && viewMode === 'filesystem') {
      loadContent(selectedSourceId, currentPath); // Remove searchQuery - search is independent
      // Don't clear selectedFileId here - let search handler manage it, or clear only on manual navigation
      // We'll clear it when viewMode changes instead (see useEffect below)
    }
  }, [selectedSourceId, currentPath, loadContent, viewMode]);

  // Clear selection when switching view modes
  useEffect(() => {
    setSelectedFileId(null);
  }, [viewMode]);

  // Status bar path is managed by view mode and navigation, not by search

  const saveApiKey = useCallback(
    async (apiKey: string, target: 'modal' | 'settings', keyType: ApiKeyType = 'openai'): Promise<boolean> => {
      try {
        const response = await window.api.saveApiKey({ apiKey, keyType });
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
    async (apiKey: string, keyType: ApiKeyType) => {
      setIsSavingApiKey(true);
      setApiKeyModalError(null);
      await saveApiKey(apiKey, 'modal', keyType);
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
        // Don't automatically open the modal - let user add key when they want
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

  const handleModelChange = useCallback(async (model: LLMModel): Promise<boolean> => {
    setIsModelBusy(true);
    try {
      const response = await window.api.saveLLMModel({ model });
      if (response.success && response.model) {
        setCurrentModel(response.model);
        setIsModelBusy(false);
        return true;
      }
      console.error('Failed to save model:', response.error);
    } catch (err) {
      console.error('Failed to save model:', err);
    }
    setIsModelBusy(false);
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
        await loadContent(selectedSourceId, currentPath);
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
    setSelectedFileId(null); // Clear selection when navigating
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
    setSearchInput(query);
    // Search is independent - doesn't affect file viewer until result is clicked
  }, []);

  const handleSourceSelect = useCallback((sourceId: number) => {
    setSelectedSourceId(sourceId);
    setCurrentPath(null);
    setPathHistory([]);
    setSearchInput(''); // Clear search input when switching sources
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

  const handleExtractContent = useCallback(async (): Promise<boolean> => {
    if (!selectedSourceId || isExtracting) return false;

    // Check if an API key is configured (needed for AI summaries and tags)
    if (!apiKeyStatus?.hasKey) {
      setApiKeyModalError(null);
      setIsApiKeyModalOpen(true);
      return false;
    }

    setIsExtracting(true);
    setExtractionProgress(null);
    setError(null);

    try {
      const response = await window.api.extractContent({
        sourceId: selectedSourceId,
      });

      if (!response.success) {
        setError(response.error || 'Failed to extract content');
        setIsExtracting(false);
        return false; // Return false to indicate failure
      }

      // CRITICAL: Wait for final progress update ('done' or 'error') before returning
      // Errors can occur asynchronously in worker pool batches after extractContent returns
      let waited = 0;
      const maxWait = 10000; // Wait up to 10 seconds for final status
      const checkInterval = 100; // Check every 100ms
      
      while (waited < maxWait && isExtracting) {
        // Check if we've received a final status update (use ref for synchronous access)
        const currentProgress = extractionProgressRef.current;
        if (currentProgress && (currentProgress.status === 'done' || currentProgress.status === 'error')) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waited += checkInterval;
      }

      // Check final status (use ref for synchronous access)
      const finalProgress = extractionProgressRef.current;
      const finalStatus = finalProgress?.status;
      
      // CRITICAL: Even if there were errors, extraction is "done" if we got here
      // Some batches may have failed and used fallback results, but extraction completed
      if (finalStatus === 'error') {
        // Log warning but don't stop - extraction completed with fallback results
        console.warn('[App] Extraction completed with some errors, using fallback results for failed batches');
        // Don't set error or return false - allow taxonomy to proceed
      }

      if (waited >= maxWait && isExtracting) {
        console.warn('[App] Timeout waiting for extraction to complete, but continuing anyway');
        // Don't set error - allow process to continue
      }

      setIsExtracting(false);
      // Always return true - extraction is "done" (with or without AI results)
      // Taxonomy can proceed with whatever data we have
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract content');
      setIsExtracting(false);
      return false; // Return false to indicate failure
    }
  }, [selectedSourceId, isExtracting, apiKeyStatus]);

  const handleOrganize = useCallback(async () => {
    if (!selectedSourceId || isOrganizing) return;

    // Check if an API key is configured
    if (!apiKeyStatus?.hasKey) {
      setApiKeyModalError(null);
      setIsApiKeyModalOpen(true);
      return;
    }

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
  }, [selectedSourceId, isOrganizing, virtualTree, loadVirtualTree, apiKeyStatus]);

  const handleOptimize = useCallback(async () => {
    if (!selectedSourceId || isOptimizing) return;

    // Check if an API key is configured
    if (!apiKeyStatus?.hasKey) {
      setApiKeyModalError(null);
      setIsApiKeyModalOpen(true);
      return;
    }

    setIsOptimizing(true);
    setOptimizerProgress(null);
    setError(null);

    const response = await window.api.runOptimizer({
      sourceId: selectedSourceId,
    });

    if (!response.success) {
      setError(response.error || 'Failed to optimize placements');
      setIsOptimizing(false);
    } else {
      // Reload virtual tree to reflect optimized placements
      await loadVirtualTree();
    }
  }, [selectedSourceId, isOptimizing, loadVirtualTree, apiKeyStatus]);

  /**
   * Run the full AI pipeline in one click:
   * 1) Scan
   * 2) Extract Content
   * 3) Organize (AI Taxonomy)
   */
  const handleFullOrganize = useCallback(async () => {
    if (!selectedSourceId || isScanning || isExtracting || isOrganizing) return;

    // Check if an API key is configured
    if (!apiKeyStatus?.hasKey) {
      setApiKeyModalError(null);
      setIsApiKeyModalOpen(true);
      return;
    }

    // Step 1: Scan filesystem + index files
    await handleScan();

    // Step 2: Extract content (summaries, tags, etc.)
    const extractionSuccess = await handleExtractContent();
    
    // CRITICAL: Stop if extraction failed
    if (!extractionSuccess) {
      console.error('[App] Extraction failed, stopping pipeline');
      return;
    }

    // CRITICAL: Ensure extraction is truly complete before starting organization
    // Wait for isExtracting to be false (handleExtractContent already waits for IPC completion)
    let waitCount = 0;
    const maxWait = 50; // Wait up to 5 seconds (50 * 100ms)
    while (isExtracting && waitCount < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitCount++;
    }

    // CRITICAL: Check for errors before proceeding
    if (error) {
      console.error('[App] Error detected after extraction, stopping pipeline:', error);
      return;
    }

    if (isExtracting) {
      console.warn('[App] Extraction still in progress after wait, stopping pipeline to prevent concurrent execution');
      return;
    }

    // Step 3: Run AI taxonomy planner to build virtual tree
    await handleOrganize();
  }, [
    selectedSourceId,
    isScanning,
    isExtracting,
    isOrganizing,
    error,
    handleScan,
    handleExtractContent,
    handleOrganize,
    apiKeyStatus,
  ]);

  const handleViewModeToggle = useCallback(() => {
    const newMode = viewMode === 'filesystem' ? 'virtual' : 'filesystem';
    setViewMode(newMode);
    localStorage.setItem('fily-view-mode', newMode);
  }, [viewMode]);

  const handleLayoutModeChange = useCallback((mode: 'library' | 'list') => {
    setLayoutMode(mode);
    localStorage.setItem('fily-layout-mode', mode);
  }, []);

  const handleVirtualPathChange = useCallback((path: string) => {
    setCurrentVirtualPath(path);
    setStatusBarPath(path === '/' ? [] : path.split('/').filter(Boolean));
    // Clear selection when navigating virtual paths
    setSelectedFileId(null);
  }, []);

  const handleLibraryPathChange = useCallback((segments: string[]) => {
    setStatusBarPath(segments);
  }, []);

  const handleVirtualLibraryPathChange = useCallback((segments: string[]) => {
    setStatusBarPath(segments);
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

  // Close layout dropdown when clicking outside
  useEffect(() => {
    if (!isLayoutMenuOpen) return;
    const handleClick = () => setIsLayoutMenuOpen(false);
    const t = setTimeout(() => document.addEventListener('click', handleClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', handleClick);
    };
  }, [isLayoutMenuOpen]);

  // Load view and layout preferences on mount
  useEffect(() => {
    const savedViewMode = localStorage.getItem('fily-view-mode');
    if (savedViewMode === 'virtual' || savedViewMode === 'filesystem') {
      setViewMode(savedViewMode);
    }
    const savedLayoutMode = localStorage.getItem('fily-layout-mode');
    if (savedLayoutMode === 'library' || savedLayoutMode === 'list') {
      setLayoutMode(savedLayoutMode);
    }
  }, []);

  // Update status bar path when switching to virtual view
  useEffect(() => {
    if (viewMode === 'virtual') {
      setStatusBarPath(currentVirtualPath === '/' ? [] : currentVirtualPath.split('/').filter(Boolean));
    }
  }, [viewMode, currentVirtualPath]);

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
            <div className="toolbar-layout-dropdown" onClick={(e) => e.stopPropagation()}>
              <button
                className="layout-dropdown-button"
                onClick={() => setIsLayoutMenuOpen((o) => !o)}
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
                      handleLayoutModeChange('library');
                      setIsLayoutMenuOpen(false);
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
                      handleLayoutModeChange('list');
                      setIsLayoutMenuOpen(false);
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
              onChange={handleSearchChange}
              onResultSelect={async (result) => {
                // Navigate to the file location and select it (stay in current view)
                try {
                  // Determine target source ID (may need to switch sources)
                  const targetSourceId = result.source_id !== selectedSourceId ? result.source_id : selectedSourceId;
                  
                  // Switch to the file's source if different
                  if (result.source_id !== selectedSourceId) {
                    setSelectedSourceId(result.source_id);
                  }

                  if (viewMode === 'filesystem') {
                    // Filesystem view: navigate to the file's parent folder
                    // Use parent_path if available, otherwise extract from relative_path
                    let targetPath: string | null = null;
                    if (result.parent_path !== null && result.parent_path !== undefined) {
                      targetPath = result.parent_path;
                    } else if (result.relative_path) {
                      // Extract parent path from relative_path
                      const pathParts = result.relative_path.split('/').filter(p => p.length > 0);
                      if (pathParts.length > 1) {
                        // File is in a subfolder - navigate to parent folder
                        targetPath = pathParts.slice(0, -1).join('/');
                      } else {
                        // File is in root - navigate to root
                        targetPath = null;
                      }
                    }
                    
                    // Set path and load content immediately
                    setCurrentPath(targetPath);
                    setPathHistory([]);
                    
                    // Explicitly load content for the new path (don't rely on useEffect timing)
                    await loadContent(targetSourceId, targetPath);
                    
                    // Set selected file AFTER content is loaded
                    setSelectedFileId(result.file_id);
                  } else {
                    // Virtual view: navigate to the file's virtual folder
                    if (result.virtual_path) {
                      // Extract parent path from virtual_path (remove filename)
                      const pathParts = result.virtual_path.split('/').filter(p => p.length > 0);
                      if (pathParts.length > 1) {
                        // File is in a virtual folder - navigate to parent folder
                        const parentVirtualPath = '/' + pathParts.slice(0, -1).join('/');
                        setCurrentVirtualPath(parentVirtualPath);
                        setStatusBarPath(pathParts.slice(0, -1));
                        // VirtualTreeView's useEffect will automatically load children for this path
                      } else {
                        // File is in root virtual folder
                        setCurrentVirtualPath('/');
                        setStatusBarPath([]);
                        // VirtualTreeView will show root children automatically
                      }
                    } else {
                      // No virtual_path - file not organized yet, stay in virtual view but show message
                      // User can switch to filesystem view manually if needed
                      setCurrentVirtualPath('/');
                      setStatusBarPath([]);
                    }
                    
                    // Set selected file (VirtualTreeView will handle highlighting)
                    setSelectedFileId(result.file_id);
                  }

                  // Clear search input after navigation
                  setSearchInput('');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to navigate to file');
                }
              }}
              disabled={selectedSourceId === null || isScanning || isExtracting}
              sourceId={selectedSourceId}
            />
            <div className="toolbar-actions">
            <button
              className="pipeline-button"
              onClick={handleFullOrganize}
              disabled={
                selectedSourceId === null || isScanning || isExtracting || isOrganizing
              }
            >
              {isScanning || isExtracting || isOrganizing
                ? 'Organizing…'
                : 'Organize'}
            </button>
            <div className="toolbar-manual">
              <button
                className="manual-button"
                disabled={
                  selectedSourceId === null || isScanning || isExtracting || isOrganizing || isOptimizing
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
                      isOrganizing ||
                      isOptimizing
                    }
                  >
                    Organize (AI Taxonomy) only
                  </button>
                  <button
                    onClick={async () => {
                      setIsManualMenuOpen(false);
                      await handleOptimize();
                    }}
                    disabled={
                      selectedSourceId === null ||
                      isScanning ||
                      isExtracting ||
                      isOrganizing ||
                      isOptimizing
                    }
                  >
                    Optimize only
                  </button>
                </div>
              )}
            </div>
          </div>
            <div className="toolbar-right">
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
        {scanProgress && scanProgress.status !== 'done' && (
          <div className="progress-banner">
            <div className="progress-content">
              <div className="progress-step-indicator">
                {scanProgress.step || 'Step 1/3: Scanning files...'}
              </div>
              {(scanProgress.filesFound > 0 && scanProgress.status === 'indexing') ? (
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
              ) : (
                <div className="progress-details">
                  <div className="progress-bar-container">
                    <div className="progress-bar-indeterminate" />
                  </div>
                </div>
              )}
              <div className="progress-status">
                <span className="progress-message">{scanProgress.message}</span>
                {scanProgress.currentFile && (
                  <span className="progress-current-file" title={scanProgress.currentFile}>
                    {scanProgress.currentFile}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Extraction Progress */}
        {extractionProgress && <ProgressBar progress={extractionProgress} />}

        {/* Planner Progress */}
        {plannerProgress && (
          <div className={`progress-banner ${plannerProgress.status === 'done' ? 'progress-complete' : ''}`}>
            <div className="progress-content">
              <div className="progress-step-indicator">
                {plannerProgress.status === 'done' ? '✅ Step 3/3: Complete!' : (plannerProgress.step || 'Step 3/3: Organizing files...')}
              </div>
              {plannerProgress.status !== 'done' ? (
                <div className="progress-details">
                  <div className="progress-bar-container">
                    <div className="progress-bar-bouncing" />
                  </div>
                </div>
              ) : null}
              <div className="progress-status">
                <span className="progress-message">{plannerProgress.message}</span>
              </div>
            </div>
          </div>
        )}

        {/* Optimizer Progress */}
        {optimizerProgress && (
          <div className={`progress-banner ${optimizerProgress.status === 'done' ? 'progress-complete' : ''}`}>
            <div className="progress-content">
              <div className="progress-step-indicator">
                {optimizerProgress.status === 'done' ? '✅ Optimize: Complete!' : (optimizerProgress.step || 'Optimizing low-confidence files...')}
              </div>
              {optimizerProgress.status !== 'done' ? (
                <div className="progress-details">
                  <div className="progress-bar-container">
                    <div className="progress-bar-bouncing" />
                  </div>
                </div>
              ) : null}
              <div className="progress-status">
                <span className="progress-message">{optimizerProgress.message}</span>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'filesystem' ? (
          selectedSourceId !== null && layoutMode === 'library' ? (
            <LibraryView
              sourceId={selectedSourceId}
              sourceName={sources.find((s) => s.id === selectedSourceId)?.name ?? ''}
              selectedFileId={selectedFileId}
              navigateToPath={viewMode === 'filesystem' ? currentPath : undefined}
              onFileSelect={setSelectedFileId}
              onPathChange={handleLibraryPathChange}
              onFileDoubleClick={handleFileDoubleClick}
              onFileRightClick={handleFileRightClick}
              onFileCardClick={handleFileCardClick}
            />
          ) : selectedSourceId !== null && layoutMode === 'list' ? (
            <>
              {files.length > 0 && (
                <div style={{ padding: '12px 24px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <strong>Tip:</strong> Right-click any file to view its extracted content.
                </div>
              )}
              <FileBrowser
                folders={folders}
                files={files}
                isLoading={isLoading}
                currentPath={currentPath}
                isSearching={false}
                selectedFileId={selectedFileId}
                onFileSelect={setSelectedFileId}
                onFolderClick={handleFolderClick}
                onFolderDoubleClick={handleFolderDoubleClick}
                onFileDoubleClick={handleFileDoubleClick}
                onFileRightClick={handleFileRightClick}
                onFileCardClick={handleFileCardClick}
                onNavigateUp={handleNavigateUp}
              />
            </>
          ) : (
            <div className="file-list-empty">Select a source folder to browse.</div>
          )
        ) : layoutMode === 'library' ? (
          <VirtualLibraryView
            virtualTree={virtualTree}
            isLoading={isLoading}
            selectedFileId={selectedFileId}
            navigateToPath={viewMode === 'virtual' ? currentVirtualPath : undefined}
            onFileSelect={setSelectedFileId}
            onPathChange={handleVirtualLibraryPathChange}
            onFileClick={handleFileDoubleClick}
            onFileRightClick={handleFileRightClick}
            onFileCardClick={handleFileCardClick}
            onLoadChildren={handleLoadVirtualChildren}
          />
        ) : (
          <VirtualTreeView
            virtualTree={virtualTree}
            isLoading={isLoading}
            currentVirtualPath={currentVirtualPath}
            selectedFileId={selectedFileId}
            onFileSelect={setSelectedFileId}
            onFileClick={handleFileDoubleClick}
            onFileRightClick={handleFileRightClick}
            onFileCardClick={handleFileCardClick}
            onPathChange={handleVirtualPathChange}
            onLoadChildren={handleLoadVirtualChildren}
          />
        )}

        <footer className="status-bar">
          <div className="status-bar-path">
            {statusBarPath.map((segment, i) => (
              <span key={i} className="status-bar-path-segment">
                {i > 0 && <span className="status-bar-path-arrow">›</span>}
                {segment}
              </span>
            ))}
            {statusBarPath.length === 0 && (
              <span className="status-bar-path-segment">—</span>
            )}
          </div>
          <MemoryInfo />
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
        currentModel={currentModel}
        onModelChange={handleModelChange}
        isModelBusy={isModelBusy}
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
