import type { IpcMain, BrowserWindow } from 'electron';
import { dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  DatabaseManager,
  Crawler,
  WatcherManager,
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
  type GetApiKeyStatusResponse,
  type SaveApiKeyResponse,
  type DeleteApiKeyResponse,
  type GetLLMModelResponse,
  type SaveLLMModelResponse,
} from '@virtual-finder/core';
import { ApiKeyStore } from './api-key-store';
import { openFile } from './file-opener';
import { registerContentHandlers } from './ipc/content-handlers';
import { registerVirtualTreeHandlers } from './ipc/virtual-tree-handlers';
import { registerPlannerHandlers } from './ipc/planner-handlers';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  db: DatabaseManager,
  getMainWindow: () => BrowserWindow | null,
  watcherManager: WatcherManager,
  apiKeyStore: ApiKeyStore
): void {
  const normalizePathForComparison = (inputPath: string): string => {
    try {
      return fs.realpathSync.native(inputPath);
    } catch {
      return path.resolve(inputPath);
    }
  };

  const isSubPath = (candidatePath: string, parentPath: string): boolean => {
    const normalizedCandidate = normalizePathForComparison(candidatePath);
    const normalizedParent = normalizePathForComparison(parentPath);
    if (normalizedCandidate === normalizedParent) {
      return false;
    }
    return normalizedCandidate.startsWith(normalizedParent + path.sep);
  };

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

        // Reconcile nested sources:
        // If this new source is a parent of already configured sources, link those sources to this parent.
        try {
          const allSources = await db.getSources();
          const sourceById = new Map(allSources.map((s) => [s.id, s]));
          const childCandidates = allSources.filter(
            (candidate) => candidate.id !== source.id && isSubPath(candidate.path, source.path)
          );

          for (const childSource of childCandidates) {
            if (childSource.parent_source_id === source.id) {
              continue;
            }

            if (childSource.parent_source_id) {
              const currentParent = sourceById.get(childSource.parent_source_id);
              if (currentParent) {
                const currentParentIsMoreSpecific =
                  isSubPath(childSource.path, currentParent.path) && currentParent.path.length >= source.path.length;
                if (currentParentIsMoreSpecific) {
                  continue;
                }
              }
            }

            await db.linkSourceToParent(childSource.id, source.id);
            console.log(
              `[IPC] Linked child source "${childSource.name}" (${childSource.id}) to new parent "${source.name}" (${source.id})`
            );
          }
        } catch (linkErr) {
          console.warn('[IPC] Failed to reconcile nested source links after adding source:', linkErr);
        }
        
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
        model,
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
        apiKeyStore.saveLLMModel(parsed.data.model);
        return SaveLLMModelResponseSchema.parse({
          success: true,
          model: parsed.data.model,
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
                  (preview.childSourceCount && preview.childSourceCount > 0
                    ? `• ${preview.childSourceCount.toLocaleString()} child sources (will be unlinked, not deleted)\n`
                    : '') +
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
        const limit = data.limit;
        const offset = data.offset;

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

  registerContentHandlers(ipcMain, db, getMainWindow);
  registerVirtualTreeHandlers(ipcMain, db);
  registerPlannerHandlers(ipcMain, db, getMainWindow);
}
