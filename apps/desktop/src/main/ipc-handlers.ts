import type { IpcMain, BrowserWindow } from 'electron';
import { dialog, shell } from 'electron';
import * as path from 'path';
import {
  DatabaseManager,
  Crawler,
  WatcherManager,
  VirtualTreeBuilder,
  IPC_CHANNELS,
  ScanSourceRequestSchema,
  ListFilesRequestSchema,
  type ListFilesRequest,
  SmartSearchFilesRequestSchema,
  type SmartSearchFilesRequest,
  type SmartSearchFilesResponse,
  ListFoldersRequestSchema,
  OpenFileRequestSchema,
  AddSourceRequestSchema,
  RemoveSourceRequestSchema,
  PreviewSourceDeletionRequestSchema,
  GetWatchStatusRequestSchema,
  StartWatchingRequestSchema,
  StopWatchingRequestSchema,
  ExtractContentRequestSchema,
  GetFileContentRequestSchema,
  GetVirtualTreeRequestSchema,
  GetVirtualChildrenRequestSchema,
  GetApiKeyStatusResponseSchema,
  SaveApiKeyRequestSchema,
  SaveApiKeyResponseSchema,
  DeleteApiKeyRequestSchema,
  DeleteApiKeyResponseSchema,
  GetLLMModelResponseSchema,
  SaveLLMModelRequestSchema,
  SaveLLMModelResponseSchema,
  type ScanSourceResponse,
  type ListFilesResponse,
  type ListFoldersResponse,
  type GetFolderTreeResponse,
  type GetSourcesResponse,
  type OpenFileResponse,
  type ScanProgress,
  type AddSourceResponse,
  type SelectFolderResponse,
  type RemoveSourceResponse,
  type PreviewSourceDeletionResponse,
  type GetMemoryUsageResponse,
  type GetWatchStatusResponse,
  type StartWatchingResponse,
  type StopWatchingResponse,
  type FileChangedEvent,
  type ExtractContentResponse,
  type ExtractionProgress,
  type GetFileContentResponse,
  type GetVirtualTreeResponse,
  type GetVirtualChildrenResponse,
  type GetApiKeyStatusResponse,
  type SaveApiKeyResponse,
  type DeleteApiKeyResponse,
  type GetLLMModelResponse,
  type SaveLLMModelResponse,
  type FileRecord,
  type PlannerOutput,
  type PlannerProgress,
  TaxonomyPlanner,
} from '@virtual-finder/core';
import { ApiKeyStore } from './api-key-store';
import { openFile } from './file-opener';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  db: DatabaseManager,
  getMainWindow: () => BrowserWindow | null,
  watcherManager: WatcherManager,
  apiKeyStore: ApiKeyStore
): void {
  // Set up IPC event emission for file changes
  watcherManager.setOnFileChangedCallback((event) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const ipcEvent: FileChangedEvent = {
        sourceId: event.sourceId,
        type: event.type,
        path: event.path,
        timestamp: Date.now(),
      };
      mainWindow.webContents.send(IPC_CHANNELS.FILE_CHANGED, ipcEvent);
    }
  });
  // Get sources
  ipcMain.handle(IPC_CHANNELS.GET_SOURCES, async (): Promise<GetSourcesResponse> => {
    try {
      const sources = await db.getSources();
      return { success: true, sources };
    } catch (error) {
      console.error('Error getting sources:', error);
      return {
        success: false,
        sources: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Select folder via native dialog
  ipcMain.handle(IPC_CHANNELS.SELECT_FOLDER, async (): Promise<SelectFolderResponse> => {
    try {
      const mainWindow = getMainWindow();
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: 'Select a folder to index',
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, cancelled: true };
      }

      const folderPath = result.filePaths[0];
      const folderName = path.basename(folderPath);

      return {
        success: true,
        path: folderPath,
        name: folderName,
        cancelled: false,
      };
    } catch (error) {
      console.error('Error selecting folder:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Add source
  ipcMain.handle(
    IPC_CHANNELS.ADD_SOURCE,
    async (_event, request: unknown): Promise<AddSourceResponse> => {
      try {
        const parsed = AddSourceRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { name, path: sourcePath } = parsed.data;

        // Check if source already exists
        const existing = await db.getSourceByPath(sourcePath);
        if (existing) {
          return {
            success: false,
            error: 'This folder is already added as a source',
          };
        }

        const source = await db.addSource(name, sourcePath);
        
        // Start watching the new source
        watcherManager.startWatching(source.id, source.path);
        console.log(`[IPC] Started watcher for newly added source: ${source.name} (${source.id})`);
        
        return { success: true, source };
      } catch (error) {
        console.error('Error adding source:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // API key status
  ipcMain.handle(IPC_CHANNELS.GET_API_KEY_STATUS, async (): Promise<GetApiKeyStatusResponse> => {
    const status = apiKeyStore.getStatus();
    const multiStatus = apiKeyStore.getMultiStatus();
    return GetApiKeyStatusResponseSchema.parse({
      success: true,
      ...status,
      multiStatus,
    });
  });

  // Save API key
  ipcMain.handle(
    IPC_CHANNELS.SAVE_API_KEY,
    async (_event, request: unknown): Promise<SaveApiKeyResponse> => {
      const parsed = SaveApiKeyRequestSchema.safeParse(request);
      if (!parsed.success) {
        return {
          success: false,
          error: `Invalid request: ${parsed.error.message}`,
        };
      }

      try {
        const keyType = parsed.data.keyType ?? 'openai';
        const status = apiKeyStore.saveKey(parsed.data.apiKey, keyType);
        return SaveApiKeyResponseSchema.parse({
          success: true,
          status,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: message,
        };
      }
    }
  );

  // Delete API key
  ipcMain.handle(IPC_CHANNELS.DELETE_API_KEY, async (_event, request?: unknown): Promise<DeleteApiKeyResponse> => {
    try {
      const parsed = DeleteApiKeyRequestSchema.safeParse(request ?? {});
      // If no keyType specified, delete the currently active provider's key
      const activeProvider = apiKeyStore.getActiveProvider();
      console.log(`[IPC] DELETE_API_KEY: activeProvider=${activeProvider}, request keyType=${parsed.success ? parsed.data.keyType : 'parse failed'}`);
      const keyType = parsed.success && parsed.data.keyType 
        ? parsed.data.keyType 
        : (activeProvider ?? 'openai');
      console.log(`[IPC] DELETE_API_KEY: deleting keyType=${keyType}`);
      const status = apiKeyStore.deleteKey(keyType);
      const multiStatus = apiKeyStore.getMultiStatus();
      return DeleteApiKeyResponseSchema.parse({
        success: true,
        status,
        multiStatus,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
      };
    }
  });

  // Get LLM model
  ipcMain.handle(IPC_CHANNELS.GET_LLM_MODEL, async (): Promise<GetLLMModelResponse> => {
    try {
      const model = apiKeyStore.getLLMModel();
      return GetLLMModelResponseSchema.parse({
        success: true,
        model: model as any,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        model: null,
        error: message,
      };
    }
  });

  // Save LLM model
  ipcMain.handle(
    IPC_CHANNELS.SAVE_LLM_MODEL,
    async (_event, request: unknown): Promise<SaveLLMModelResponse> => {
      const parsed = SaveLLMModelRequestSchema.safeParse(request);
      if (!parsed.success) {
        return {
          success: false,
          error: `Invalid request: ${parsed.error.message}`,
        };
      }

      try {
        const model = apiKeyStore.saveLLMModel(parsed.data.model);
        return SaveLLMModelResponseSchema.parse({
          success: true,
          model: model as any,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: message,
        };
      }
    }
  );

  // Preview source deletion (shows what will be deleted)
  ipcMain.handle(
    IPC_CHANNELS.PREVIEW_SOURCE_DELETION,
    async (_event, request: unknown): Promise<PreviewSourceDeletionResponse> => {
      try {
        const parsed = PreviewSourceDeletionRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { sourceId } = parsed.data;
        const preview = await db.previewSourceDeletion(sourceId);
        return {
          success: true,
          fileCount: preview.fileCount,
          folderCount: preview.folderCount,
          virtualPlacementCount: preview.virtualPlacementCount,
          fileContentCount: preview.fileContentCount,
          eventCount: preview.eventCount,
          childSourceCount: preview.childSourceCount,
          sourceName: preview.sourceName,
          sourcePath: preview.sourcePath,
        };
      } catch (error) {
        console.error('Error previewing source deletion:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Remove source (with confirmation dialog)
  ipcMain.handle(
    IPC_CHANNELS.REMOVE_SOURCE,
    async (_event, request: unknown): Promise<RemoveSourceResponse> => {
      try {
        const parsed = RemoveSourceRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { sourceId } = parsed.data;
        
        // Get preview of what will be deleted
        const preview = await db.previewSourceDeletion(sourceId);
        
        // Show confirmation dialog
        const mainWindow = getMainWindow();
        const response = await dialog.showMessageBox(mainWindow!, {
          type: 'warning',
          title: 'Confirm Source Deletion',
          message: `Delete source "${preview.sourceName}"?`,
          detail: `This will permanently delete from Fily:\n\n` +
                  `• ${preview.fileCount.toLocaleString()} files\n` +
                  `• ${preview.folderCount.toLocaleString()} folders\n` +
                  `• ${preview.virtualPlacementCount.toLocaleString()} virtual placements\n` +
                  (preview.fileContentCount && preview.fileContentCount > 0 ? `• ${preview.fileContentCount.toLocaleString()} file content records\n` : '') +
                  (preview.eventCount && preview.eventCount > 0 ? `• ${preview.eventCount.toLocaleString()} watch events\n` : '') +
                  (preview.childSourceCount && preview.childSourceCount > 0 ? `• ${preview.childSourceCount.toLocaleString()} child sources\n` : '') +
                  `\n⚠️ This only deletes data from Fily.\n` +
                  `Your actual files at "${preview.sourcePath}" will NOT be deleted.`,
          buttons: ['Cancel', 'Delete'],
          defaultId: 0,
          cancelId: 0,
        });

        if (response.response === 0) {
          // User cancelled
          return {
            success: false,
            error: 'Deletion cancelled by user',
          };
        }

        // User confirmed - proceed with deletion
        await db.removeSource(sourceId);
        return { success: true };
      } catch (error) {
        console.error('Error removing source:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Scan source with progress updates
  ipcMain.handle(
    IPC_CHANNELS.SCAN_SOURCE,
    async (_event, request: unknown): Promise<ScanSourceResponse> => {
      try {
        // Validate request
        const parsed = ScanSourceRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            filesScanned: 0,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { sourceId } = parsed.data;

        // Get source details
        const source = await db.getSourceById(sourceId);
        if (!source) {
          return {
            success: false,
            filesScanned: 0,
            error: `Source not found: ${sourceId}`,
          };
        }

        const mainWindow = getMainWindow();

        // Run crawler with progress callback
        const crawler = new Crawler(db);
        const result = await crawler.scan(sourceId, source.path, (progress: ScanProgress) => {
          console.log('Scan progress:', progress.message);
          // Send progress to renderer with step information
          if (mainWindow && !mainWindow.isDestroyed()) {
            const enhancedProgress = {
              ...progress,
              step: `Step 1/3: ${progress.status === 'scanning' ? 'Scanning filesystem...' : progress.status === 'indexing' ? 'Indexing files...' : progress.status === 'cleaning' ? 'Cleaning up...' : 'Scan complete'}`,
              phase: progress.status,
            } as ScanProgress;
            mainWindow.webContents.send(IPC_CHANNELS.SCAN_PROGRESS, enhancedProgress);
          }
        });

        return {
          success: result.errors.length === 0,
          filesScanned: result.filesScanned,
          filesRemoved: result.filesRemoved,
          error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
        };
      } catch (error) {
        console.error('Error scanning source:', error);
        return {
          success: false,
          filesScanned: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // List folders
  ipcMain.handle(
    IPC_CHANNELS.LIST_FOLDERS,
    async (_event, request: unknown): Promise<ListFoldersResponse> => {
      try {
        const parsed = ListFoldersRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            folders: [],
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { sourceId, parentPath, query } = parsed.data;
        const folders = await db.getFoldersBySource(sourceId, parentPath, query);

        return { success: true, folders };
      } catch (error) {
        console.error('Error listing folders:', error);
        return {
          success: false,
          folders: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Get full folder tree (for AI context)
  ipcMain.handle(
    IPC_CHANNELS.GET_FOLDER_TREE,
    async (_event, request: unknown): Promise<GetFolderTreeResponse> => {
      try {
        const parsed = ListFoldersRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            folders: [],
            totalFiles: 0,
            totalFolders: 0,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { sourceId } = parsed.data;
        const folders = await db.getAllFolders(sourceId);
        const totalFiles = await db.getFileCount(sourceId);
        const totalFolders = folders.length;

        return { success: true, folders, totalFiles, totalFolders };
      } catch (error) {
        console.error('Error getting folder tree:', error);
        return {
          success: false,
          folders: [],
          totalFiles: 0,
          totalFolders: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Open folder in Finder
  ipcMain.handle(
    IPC_CHANNELS.OPEN_FOLDER,
    async (_event, request: unknown): Promise<OpenFileResponse> => {
      try {
        const parsed = OpenFileRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { path: folderPath } = parsed.data;
        shell.showItemInFolder(folderPath);

        return { success: true };
      } catch (error) {
        console.error('Error opening folder:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // List files
  ipcMain.handle(
    IPC_CHANNELS.LIST_FILES,
    async (_event, request: unknown): Promise<ListFilesResponse> => {
      try {
        // Validate request
        const parsed = ListFilesRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            files: [],
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const data = parsed.data;
        const { sourceId, query, parentPath } = data;
        // TypeScript may cache old zod schema types, but runtime will have correct values
        const limit = (data as any).limit;
        const offset = (data as any).offset;

        // Get files from database with pagination
        // Default: limit=100, offset=0 for infinite scroll
        const files = await db.getFilesBySource(sourceId, query, parentPath ?? null, limit, offset);

        return { success: true, files };
      } catch (error) {
        console.error('Error listing files:', error);
        return {
          success: false,
          files: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Smart search files (ranked: filename > summary > tags)
  ipcMain.handle(
    IPC_CHANNELS.SMART_SEARCH_FILES,
    async (_event, request: unknown): Promise<SmartSearchFilesResponse> => {
      try {
        const parsed = SmartSearchFilesRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            results: [],
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { query, sourceId, limit } = parsed.data;
        const results = await db.smartSearchFiles(query, sourceId, limit);

        // Convert to response format
        return {
          success: true,
          results: results.map((r: {
            file_id: string;
            name: string;
            path: string;
            relative_path: string | null;
            parent_path: string | null;
            extension: string;
            size: number;
            mtime: number;
            source_id: number;
            match_type: 'filename' | 'summary' | 'tags';
            match_score: number;
            summary: string | null;
            tags: string[] | null;
            virtual_path: string | null;
          }) => ({
            file_id: r.file_id,
            name: r.name,
            path: r.path,
            relative_path: r.relative_path,
            parent_path: r.parent_path,
            extension: r.extension,
            size: r.size,
            mtime: r.mtime,
            source_id: r.source_id,
            match_type: r.match_type,
            match_score: r.match_score,
            summary: r.summary,
            tags: r.tags || undefined,
            virtual_path: r.virtual_path,
          })),
        };
      } catch (error) {
        console.error('Error in smart search:', error);
        return {
          success: false,
          results: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Open file
  ipcMain.handle(
    IPC_CHANNELS.OPEN_FILE,
    async (_event, request: unknown): Promise<OpenFileResponse> => {
      try {
        // Validate request
        const parsed = OpenFileRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { path: filePath } = parsed.data;

        // Open file with default application
        await openFile(filePath);

        return { success: true };
      } catch (error) {
        console.error('Error opening file:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Get memory usage
  ipcMain.handle(IPC_CHANNELS.GET_MEMORY_USAGE, async (): Promise<GetMemoryUsageResponse> => {
    try {
      const usage = process.memoryUsage();
      return {
        success: true,
        memory: {
          heapUsed: usage.heapUsed,
          heapTotal: usage.heapTotal,
          external: usage.external,
          rss: usage.rss,
        },
      };
    } catch (error) {
      console.error('Error getting memory usage:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Get watch status
  ipcMain.handle(
    IPC_CHANNELS.GET_WATCH_STATUS,
    async (_event, request: unknown): Promise<GetWatchStatusResponse> => {
      try {
        const parsed = GetWatchStatusRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            watching: false,
            sourceIds: [],
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { sourceId } = parsed.data;
        if (sourceId !== undefined) {
          const watching = watcherManager.isWatching(sourceId);
          return {
            success: true,
            watching,
            sourceIds: watching ? [sourceId] : [],
          };
        } else {
          const sourceIds = watcherManager.getAllWatchingSourceIds();
          return {
            success: true,
            watching: sourceIds.length > 0,
            sourceIds,
          };
        }
      } catch (error) {
        console.error('Error getting watch status:', error);
        return {
          success: false,
          watching: false,
          sourceIds: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Start watching
  ipcMain.handle(
    IPC_CHANNELS.START_WATCHING,
    async (_event, request: unknown): Promise<StartWatchingResponse> => {
      try {
        const parsed = StartWatchingRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { sourceId } = parsed.data;
        const source = await db.getSourceById(sourceId);
        if (!source) {
          return {
            success: false,
            error: `Source not found: ${sourceId}`,
          };
        }

        watcherManager.startWatching(sourceId, source.path);
        return { success: true };
      } catch (error) {
        console.error('Error starting watch:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Stop watching
  ipcMain.handle(
    IPC_CHANNELS.STOP_WATCHING,
    async (_event, request: unknown): Promise<StopWatchingResponse> => {
      try {
        const parsed = StopWatchingRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
          };
        }

        const { sourceId } = parsed.data;
        watcherManager.stopWatching(sourceId);
        return { success: true };
      } catch (error) {
        console.error('Error stopping watch:', error);
        return {
          success: false,
        };
      }
    }
  );

  // Extract content from files
  ipcMain.handle(
    IPC_CHANNELS.EXTRACT_CONTENT,
    async (_event, request: unknown): Promise<ExtractContentResponse> => {
      try {
        const parsed = ExtractContentRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            filesProcessed: 0,
            errors: 0,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { sourceId } = parsed.data;
        const mainWindow = getMainWindow();

        // Emit extraction started
        const emitProgress = (progress: ExtractionProgress & { step?: string; phase?: string }) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC_CHANNELS.EXTRACTION_PROGRESS, progress as ExtractionProgress);
          }
        };

        emitProgress({
          status: 'extracting',
          filesProcessed: 0,
          filesTotal: 0,
          currentFile: '',
          message: 'Starting content extraction...',
        });

        // Get files to extract (only files without content, or all if sourceId specified)
        let files: FileRecord[];
        if (sourceId !== undefined) {
          // Get files without extracted content for this source
          const fileIdsWithoutContent = await db.getFilesWithoutContent(sourceId);
          files = await db.getFilesBySource(sourceId, undefined, undefined, -1);
          // Filter to only files without content
          files = files.filter(f => fileIdsWithoutContent.includes(f.file_id));
        } else {
          // Extract for all sources
          const sources = await db.getSources();
          const allFiles: FileRecord[] = [];
          for (const source of sources) {
            const fileIdsWithoutContent = await db.getFilesWithoutContent(source.id);
            const sourceFiles = await db.getFilesBySource(source.id, undefined, undefined, -1);
            allFiles.push(...sourceFiles.filter(f => fileIdsWithoutContent.includes(f.file_id)));
          }
          files = allFiles;
        }

        if (files.length === 0) {
          emitProgress({
            status: 'done',
            filesProcessed: 0,
            filesTotal: 0,
            currentFile: '',
            message: 'No files need content extraction',
            step: `Step 2/3: Extracting content...`,
            phase: 'done',
          });
          return {
            success: true,
            filesProcessed: 0,
            errors: 0,
          };
        }

        emitProgress({
          status: 'extracting',
          filesProcessed: 0,
          filesTotal: files.length,
          currentFile: '',
          message: `Extracting content from ${files.length} files...`,
          step: `Step 2/3: Extracting content...`,
          phase: 'extracting',
        });

        // Run content extraction
        const { ContentService } = await import('@virtual-finder/core');
        const contentService = new ContentService(db);
        
        const result = await contentService.extractContent(files, (progress) => {
          emitProgress(progress);
        });

        return {
          success: true,
          filesProcessed: result.filesProcessed,
          errors: result.errors,
        };
      } catch (error) {
        console.error('Error extracting content:', error);
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.EXTRACTION_PROGRESS, {
            status: 'error',
            filesProcessed: 0,
            filesTotal: 0,
            currentFile: '',
            message: error instanceof Error ? error.message : 'Unknown error',
            step: `Step 2/3: Extracting content...`,
            phase: 'error',
          });
        }
        return {
          success: false,
          filesProcessed: 0,
          errors: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Get file content
  ipcMain.handle(
    IPC_CHANNELS.GET_FILE_CONTENT,
    async (_event, request: unknown): Promise<GetFileContentResponse> => {
      try {
        const parsed = GetFileContentRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            content: null,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { fileId } = parsed.data;
        const content = await db.getFileContent(fileId);

        return {
          success: true,
          content: content || null,
        };
      } catch (error) {
        console.error('Error getting file content:', error);
        return {
          success: false,
          content: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Get virtual tree
  ipcMain.handle(
    IPC_CHANNELS.GET_VIRTUAL_TREE,
    async (_event, request: unknown): Promise<GetVirtualTreeResponse> => {
      try {
        const parsed = GetVirtualTreeRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { sourceId } = parsed.data;

        const totalStartTime = Date.now();
        console.log(`[Performance] Starting virtual tree load for source ${sourceId || 'all'}...`);

        // Check total count first to decide if we need optimized queries
        const countStartTime = Date.now();
        const totalCount = await db.getVirtualPlacementCount(sourceId);
        const countTime = Date.now() - countStartTime;
        console.log(`[Performance] Total virtual placements count: ${totalCount.toLocaleString()} (queried in ${countTime}ms)`);
        
        if (totalCount === 0) {
          return {
            success: true,
            tree: {
              id: 'root',
              name: 'Virtual Files',
              path: '/',
              type: 'folder',
              children: [],
            },
          };
        }

        // Build tree - use top-level only for fast initial load (large datasets)
        // Full tree is built lazily when folders are expanded
        const buildStartTime = Date.now();
        const builder = new VirtualTreeBuilder();
        
        let tree: any;
        if (totalCount > 10000) {
          // Large dataset: use optimized queries (only top-level placements)
          // This makes initial load instant instead of blocking for seconds
          const placementsStartTime = Date.now();
          const topLevelPlacements = await db.getTopLevelVirtualPlacements(sourceId);
          const placementsTime = Date.now() - placementsStartTime;
          console.log(`[Performance] Loaded ${topLevelPlacements.length.toLocaleString()} top-level placements in ${placementsTime}ms (optimized query)`);
          
          tree = builder.buildTopLevelOnly(topLevelPlacements, totalCount);
          const buildTime = Date.now() - buildStartTime;
          const totalTime = Date.now() - totalStartTime;
          console.log(`[Performance] Built top-level tree structure in ${buildTime}ms (lazy loading enabled)`);
          console.log(`[Performance] Total virtual tree load time: ${totalTime}ms (skipped loading ${(totalCount - topLevelPlacements.length).toLocaleString()} deep placements)`);
        } else {
          // Small dataset: load all placements and build full tree immediately
          const placementsStartTime = Date.now();
          const placements = await db.getVirtualPlacements(sourceId);
          const placementsTime = Date.now() - placementsStartTime;
          console.log(`[Performance] Loaded ${placements.length.toLocaleString()} virtual placements in ${placementsTime}ms`);
          // Small dataset: build full tree immediately (load file records)
          const fileRecordsMap = new Map<string, any>();
          
          if (placements.length > 0) {
            const dbInstance = (db as any).ensureReady();
            const fileLoadStartTime = Date.now();
            
            // Use JOIN to get placements and files in one query (much faster)
            if (sourceId !== undefined) {
              const source = await db.getSourceById(sourceId);
              if (source) {
                const sourceIds: number[] = [sourceId];
                if (source.parent_source_id) {
                  sourceIds.push(source.parent_source_id);
                }
                
                const placeholders = sourceIds.map(() => '?').join(',');
                const stmt = dbInstance.prepare(`
                  SELECT 
                    f.id, f.file_id, f.path, f.name, f.extension, f.size, f.mtime, 
                    f.source_id, f.relative_path, f.parent_path, f.created_at, f.updated_at
                  FROM virtual_placements vp
                  INNER JOIN files f ON vp.file_id = f.file_id
                  WHERE f.source_id IN (${placeholders})
                  AND (f.status IS NULL OR f.status = 'present')
                `);
                const rows = stmt.all(...sourceIds) as Array<any>;
                
                for (const row of rows) {
                  fileRecordsMap.set(row.file_id, {
                    id: row.id,
                    file_id: row.file_id,
                    path: row.path,
                    name: row.name,
                    extension: row.extension,
                    size: row.size,
                    mtime: row.mtime,
                    source_id: row.source_id,
                    relative_path: row.relative_path,
                    parent_path: row.parent_path,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                  });
                }
              }
            } else {
              const stmt = dbInstance.prepare(`
                SELECT 
                  f.id, f.file_id, f.path, f.name, f.extension, f.size, f.mtime, 
                  f.source_id, f.relative_path, f.parent_path, f.created_at, f.updated_at
                FROM virtual_placements vp
                INNER JOIN files f ON vp.file_id = f.file_id
                WHERE (f.status IS NULL OR f.status = 'present')
              `);
              const rows = stmt.all() as Array<any>;
              
              for (const row of rows) {
                fileRecordsMap.set(row.file_id, {
                  id: row.id,
                  file_id: row.file_id,
                  path: row.path,
                  name: row.name,
                  extension: row.extension,
                  size: row.size,
                  mtime: row.mtime,
                  source_id: row.source_id,
                  relative_path: row.relative_path,
                  parent_path: row.parent_path,
                  created_at: row.created_at,
                  updated_at: row.updated_at,
                });
              }
            }
            
            const fileLoadTime = Date.now() - fileLoadStartTime;
            console.log(`[Performance] Loaded ${fileRecordsMap.size.toLocaleString()} file records via JOIN in ${fileLoadTime}ms`);
          }
          
          tree = builder.buildFromPlacements(placements, fileRecordsMap);
          const buildTime = Date.now() - buildStartTime;
          const totalTime = Date.now() - totalStartTime;
          console.log(`[Performance] Built full virtual tree in ${buildTime}ms`);
          console.log(`[Performance] Total virtual tree load time: ${totalTime}ms`);
        }

        return {
          success: true,
          tree,
        };
      } catch (error) {
        console.error('Error getting virtual tree:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Get virtual children
  ipcMain.handle(
    IPC_CHANNELS.GET_VIRTUAL_CHILDREN,
    async (_event, request: unknown): Promise<GetVirtualChildrenResponse> => {
      try {
        const parsed = GetVirtualChildrenRequestSchema.safeParse(request);
        if (!parsed.success) {
          return {
            success: false,
            children: [],
            error: `Invalid request: ${parsed.error.message}`,
          };
        }

        const { virtualPath, sourceId } = parsed.data;

        // Get placements filtered by virtual path (only children of requested path)
        const placements = await db.getVirtualPlacementsByPath(virtualPath, sourceId);
        
        if (placements.length === 0) {
          return {
            success: true,
            children: [],
          };
        }

        // Get file records for these placements only (using JOIN for efficiency)
        const fileRecordsMap = new Map<string, any>();
        const dbInstance = (db as any).ensureReady();
        
        if (sourceId !== undefined) {
          const source = await db.getSourceById(sourceId);
          if (source) {
            const sourceIds: number[] = [sourceId];
            if (source.parent_source_id) {
              sourceIds.push(source.parent_source_id);
            }
            
            const fileIds = placements.map((p) => p.file_id);
            if (fileIds.length > 0) {
              // Use JOIN query for efficiency
              const placeholders = sourceIds.map(() => '?').join(',');
              const fileIdPlaceholders = fileIds.map(() => '?').join(',');
              const stmt = dbInstance.prepare(`
                SELECT 
                  f.id, f.file_id, f.path, f.name, f.extension, f.size, f.mtime, 
                  f.source_id, f.relative_path, f.parent_path, f.created_at, f.updated_at
                FROM files f
                WHERE f.file_id IN (${fileIdPlaceholders})
                AND f.source_id IN (${placeholders})
                AND (f.status IS NULL OR f.status = 'present')
              `);
              const rows = stmt.all(...fileIds, ...sourceIds) as Array<any>;
              
              for (const row of rows) {
                fileRecordsMap.set(row.file_id, {
                  id: row.id,
                  file_id: row.file_id,
                  path: row.path,
                  name: row.name,
                  extension: row.extension,
                  size: row.size,
                  mtime: row.mtime,
                  source_id: row.source_id,
                  relative_path: row.relative_path,
                  parent_path: row.parent_path,
                  created_at: row.created_at,
                  updated_at: row.updated_at,
                });
              }
            }
          }
        } else {
          const fileIds = placements.map((p) => p.file_id);
          if (fileIds.length > 0) {
            const fileIdPlaceholders = fileIds.map(() => '?').join(',');
            const stmt = dbInstance.prepare(`
              SELECT 
                f.id, f.file_id, f.path, f.name, f.extension, f.size, f.mtime, 
                f.source_id, f.relative_path, f.parent_path, f.created_at, f.updated_at
              FROM files f
              WHERE f.file_id IN (${fileIdPlaceholders})
              AND (f.status IS NULL OR f.status = 'present')
            `);
            const rows = stmt.all(...fileIds) as Array<any>;
            
            for (const row of rows) {
              fileRecordsMap.set(row.file_id, {
                id: row.id,
                file_id: row.file_id,
                path: row.path,
                name: row.name,
                extension: row.extension,
                size: row.size,
                mtime: row.mtime,
                source_id: row.source_id,
                relative_path: row.relative_path,
                parent_path: row.parent_path,
                created_at: row.created_at,
                updated_at: row.updated_at,
              });
            }
          }
        }

        // Build tree for this path only (much faster than building full tree)
        const builder = new VirtualTreeBuilder();
        const outputs: PlannerOutput[] = placements.map((p) => ({
          file_id: p.file_id,
          virtual_path: p.virtual_path,
          tags: JSON.parse(p.tags),
          confidence: p.confidence,
          reason: p.reason,
        }));
        
        // Build a temporary root and extract children at the requested path
        const tempRoot = builder.build(outputs, fileRecordsMap);
        const children = builder.getChildren(tempRoot, virtualPath);

        return {
          success: true,
          children,
        };
      } catch (error) {
        console.error('Error getting virtual children:', error);
        return {
          success: false,
          children: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Run AI planner to generate virtual placements
  ipcMain.handle(
    (IPC_CHANNELS as any).RUN_PLANNER,
    async (_event, request: unknown): Promise<{ success: boolean; filesPlanned: number; error?: string }> => {
      const mainWindow = getMainWindow();

      const emitProgress = (progress: PlannerProgress & { step?: string; phase?: string; progressPercent?: number }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send((IPC_CHANNELS as any).PLANNER_PROGRESS, progress as PlannerProgress);
        }
      };

      try {
        const req = (request || {}) as { sourceId?: number };
        if (typeof req.sourceId !== 'number') {
          return {
            success: false,
            filesPlanned: 0,
            error: 'sourceId is required to run planner',
          };
        }

        const { sourceId } = req;

        emitProgress({
          status: 'planning',
          filesTotal: 0,
          filesPlanned: 0,
          message: `Loading files for source ${sourceId}...`,
          step: `Step 3/3: Organizing files...`,
          phase: 'loading',
          progressPercent: 0,
        } as PlannerProgress & { step?: string; phase?: string; progressPercent?: number });

        const files: FileRecord[] = await db.getFilesBySource(
          sourceId,
          undefined,
          undefined,
          -1
        );

        if (files.length === 0) {
          emitProgress({
            status: 'done',
            filesTotal: 0,
            filesPlanned: 0,
            message: 'No files found to organize.',
            step: `Step 3/3: Organizing files...`,
            phase: 'done',
            progressPercent: 100,
          } as PlannerProgress & { step?: string; phase?: string; progressPercent?: number });
          return {
            success: true,
            filesPlanned: 0,
          };
        }

        emitProgress({
          status: 'planning',
          filesTotal: files.length,
          filesPlanned: 0,
          message: `Step 2/3 – Running AI taxonomy planner on ${files.length.toLocaleString()} files. This can take a little while for larger sources...`,
        });

        const planner = new TaxonomyPlanner(db);
        const outputs: PlannerOutput[] = await planner.plan(files);

        console.log(
          `[TaxonomyPlanner] Organized ${outputs.length.toLocaleString()} files using ${planner.id} v${planner.version}`
        );

        emitProgress({
          status: 'storing',
          filesTotal: outputs.length,
          filesPlanned: 0,
          message: `Storing ${outputs.length.toLocaleString()} virtual placements...`,
          step: `Step 3/3: Organizing files...`,
          phase: 'storing',
          progressPercent: 90,
        } as PlannerProgress & { step?: string; phase?: string; progressPercent?: number });

        await db.upsertVirtualPlacementBatch(outputs, planner.version);

        emitProgress({
          status: 'done',
          filesTotal: outputs.length,
          filesPlanned: outputs.length,
          message: 'AI virtual organization complete.',
          step: `Step 3/3: Organizing files...`,
          phase: 'done',
          progressPercent: 100,
        } as PlannerProgress & { step?: string; phase?: string; progressPercent?: number });

        return {
          success: true,
          filesPlanned: outputs.length,
        };
      } catch (error) {
        console.error('Error running AI planner:', error);
        emitProgress({
          status: 'error',
          filesTotal: 0,
          filesPlanned: 0,
          message: error instanceof Error ? error.message : 'Unknown planner error',
          step: `Step 3/3: Organizing files...`,
          phase: 'error',
          progressPercent: 0,
        } as PlannerProgress & { step?: string; phase?: string; progressPercent?: number });
        return {
          success: false,
          filesPlanned: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
