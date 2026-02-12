import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import {
  IPC_CHANNELS,
  ScanSourceRequestSchema,
  ScanSourceResponseSchema,
  ScanProgressSchema,
  ListFilesRequestSchema,
  ListFilesResponseSchema,
  SmartSearchFilesRequestSchema,
  SmartSearchFilesResponseSchema,
  type SmartSearchFilesRequest,
  type SmartSearchFilesResponse,
  ListFoldersRequestSchema,
  ListFoldersResponseSchema,
  GetFolderTreeResponseSchema,
  OpenFileRequestSchema,
  OpenFileResponseSchema,
  GetSourcesResponseSchema,
  AddSourceRequestSchema,
  AddSourceResponseSchema,
  SelectFolderResponseSchema,
  RemoveSourceRequestSchema,
  RemoveSourceResponseSchema,
  PreviewSourceDeletionRequestSchema,
  PreviewSourceDeletionResponseSchema,
  GetMemoryUsageResponseSchema,
  FileChangedEventSchema,
  GetWatchStatusRequestSchema,
  GetWatchStatusResponseSchema,
  StartWatchingRequestSchema,
  StartWatchingResponseSchema,
  StopWatchingRequestSchema,
  StopWatchingResponseSchema,
  ExtractContentRequestSchema,
  ExtractContentResponseSchema,
  ExtractionProgressSchema,
  GetFileContentRequestSchema,
  GetFileContentResponseSchema,
  GetVirtualTreeRequestSchema,
  GetVirtualTreeResponseSchema,
  GetVirtualChildrenRequestSchema,
  GetVirtualChildrenResponseSchema,
  GetApiKeyStatusResponseSchema,
  SaveApiKeyRequestSchema,
  SaveApiKeyResponseSchema,
  DeleteApiKeyResponseSchema,
  GetLLMModelResponseSchema,
  SaveLLMModelRequestSchema,
  SaveLLMModelResponseSchema,
  type ScanSourceRequest,
  type ScanSourceResponse,
  type ScanProgress,
  type ListFilesRequest,
  type ListFilesResponse,
  type ListFoldersRequest,
  type ListFoldersResponse,
  type GetFolderTreeResponse,
  type OpenFileRequest,
  type OpenFileResponse,
  type GetSourcesResponse,
  type AddSourceRequest,
  type AddSourceResponse,
  type SelectFolderResponse,
  type RemoveSourceRequest,
  type RemoveSourceResponse,
  type PreviewSourceDeletionRequest,
  type PreviewSourceDeletionResponse,
  type GetMemoryUsageResponse,
  type FileChangedEvent,
  type GetWatchStatusRequest,
  type GetWatchStatusResponse,
  type StartWatchingRequest,
  type StartWatchingResponse,
  type StopWatchingRequest,
  type StopWatchingResponse,
  type ExtractContentRequest,
  type ExtractContentResponse,
  type ExtractionProgress,
  type GetFileContentRequest,
  type GetFileContentResponse,
  type GetVirtualTreeRequest,
  type GetVirtualTreeResponse,
  type GetVirtualChildrenRequest,
  type GetVirtualChildrenResponse,
  type GetApiKeyStatusResponse,
  type SaveApiKeyRequest,
  type SaveApiKeyResponse,
  type DeleteApiKeyResponse,
  type GetLLMModelResponse,
  type SaveLLMModelRequest,
  type SaveLLMModelResponse,
} from '@virtual-finder/core';

type RunPlannerRequest = {
  sourceId?: number;
};

type RunPlannerResponse = {
  success: boolean;
  filesPlanned: number;
  error?: string;
};

type PlannerProgress = {
  status: 'planning' | 'storing' | 'done' | 'error';
  filesTotal: number;
  filesPlanned: number;
  message: string;
};

const RunPlannerResponseSchema = z.object({
  success: z.boolean(),
  filesPlanned: z.number(),
  error: z.string().optional(),
});

const PlannerProgressSchema = z.object({
  status: z.enum(['planning', 'storing', 'done', 'error']),
  filesTotal: z.number(),
  filesPlanned: z.number(),
  message: z.string(),
});

/**
 * Type-safe IPC wrapper with zod validation.
 * 
 * This preload script creates a secure bridge between the renderer
 * and main process. All requests and responses are validated with zod.
 */

async function invoke<TReq, TRes>(
  channel: string,
  requestSchema: z.ZodSchema<TReq> | null,
  responseSchema: z.ZodSchema<TRes>,
  request?: TReq
): Promise<TRes> {
  // Validate request if schema provided
  if (requestSchema && request !== undefined) {
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success) {
      throw new Error(`Invalid request: ${parsed.error.message}`);
    }
  }

  // Make IPC call
  const response = await ipcRenderer.invoke(channel, request);

  // Validate response
  const parsedResponse = responseSchema.safeParse(response);
  if (!parsedResponse.success) {
    console.error('Invalid response from main process:', response);
    throw new Error(`Invalid response: ${parsedResponse.error.message}`);
  }

  return parsedResponse.data;
}

// Expose API to renderer
const api = {
  /**
   * Get all sources.
   */
  getSources: (): Promise<GetSourcesResponse> => {
    return invoke(
      IPC_CHANNELS.GET_SOURCES,
      null,
      GetSourcesResponseSchema
    );
  },

  /**
   * Open native folder selection dialog.
   */
  selectFolder: (): Promise<SelectFolderResponse> => {
    return invoke(
      IPC_CHANNELS.SELECT_FOLDER,
      null,
      SelectFolderResponseSchema
    );
  },

  /**
   * Add a new source folder.
   */
  addSource: (request: AddSourceRequest): Promise<AddSourceResponse> => {
    return invoke(
      IPC_CHANNELS.ADD_SOURCE,
      AddSourceRequestSchema,
      AddSourceResponseSchema,
      request
    );
  },

  /**
   * Preview what will be deleted when removing a source.
   */
  previewSourceDeletion: (request: PreviewSourceDeletionRequest): Promise<PreviewSourceDeletionResponse> => {
    return invoke(
      IPC_CHANNELS.PREVIEW_SOURCE_DELETION,
      PreviewSourceDeletionRequestSchema,
      PreviewSourceDeletionResponseSchema,
      request
    );
  },

  /**
   * Remove a source folder (shows confirmation dialog).
   */
  removeSource: (request: RemoveSourceRequest): Promise<RemoveSourceResponse> => {
    return invoke(
      IPC_CHANNELS.REMOVE_SOURCE,
      RemoveSourceRequestSchema,
      RemoveSourceResponseSchema,
      request
    );
  },

  /**
   * Scan a source directory and index files.
   */
  scanSource: (request: ScanSourceRequest): Promise<ScanSourceResponse> => {
    return invoke(
      IPC_CHANNELS.SCAN_SOURCE,
      ScanSourceRequestSchema,
      ScanSourceResponseSchema,
      request
    );
  },

  /**
   * Subscribe to scan progress updates.
   */
  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => {
      const parsed = ScanProgressSchema.safeParse(progress);
      if (parsed.success) {
        callback(parsed.data);
      } else {
        console.error('Invalid progress from main process:', progress);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.SCAN_PROGRESS, handler);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SCAN_PROGRESS, handler);
    };
  },

  /**
   * List files for a source, optionally filtered by query or parent path.
   */
  listFiles: (request: ListFilesRequest): Promise<ListFilesResponse> => {
    return invoke(
      IPC_CHANNELS.LIST_FILES,
      ListFilesRequestSchema,
      ListFilesResponseSchema,
      request
    );
  },

  /**
   * Smart search files with ranking (filename > summary > tags).
   */
  smartSearchFiles: (request: SmartSearchFilesRequest): Promise<SmartSearchFilesResponse> => {
    return invoke(
      IPC_CHANNELS.SMART_SEARCH_FILES,
      SmartSearchFilesRequestSchema,
      SmartSearchFilesResponseSchema,
      request
    );
  },

  /**
   * List folders for a source, optionally filtered by parent path.
   */
  listFolders: (request: ListFoldersRequest): Promise<ListFoldersResponse> => {
    return invoke(
      IPC_CHANNELS.LIST_FOLDERS,
      ListFoldersRequestSchema,
      ListFoldersResponseSchema,
      request
    );
  },

  /**
   * Get the full folder tree for a source (useful for AI context).
   */
  getFolderTree: (request: ListFoldersRequest): Promise<GetFolderTreeResponse> => {
    return invoke(
      IPC_CHANNELS.GET_FOLDER_TREE,
      ListFoldersRequestSchema,
      GetFolderTreeResponseSchema,
      request
    );
  },

  /**
   * Open a file with the default macOS application.
   */
  openFile: (request: OpenFileRequest): Promise<OpenFileResponse> => {
    return invoke(
      IPC_CHANNELS.OPEN_FILE,
      OpenFileRequestSchema,
      OpenFileResponseSchema,
      request
    );
  },

  /**
   * Open a folder in Finder.
   */
  openFolder: (request: OpenFileRequest): Promise<OpenFileResponse> => {
    return invoke(
      IPC_CHANNELS.OPEN_FOLDER,
      OpenFileRequestSchema,
      OpenFileResponseSchema,
      request
    );
  },

  /**
   * Get current memory usage statistics.
   */
  getMemoryUsage: (): Promise<GetMemoryUsageResponse> => {
    return invoke(
      IPC_CHANNELS.GET_MEMORY_USAGE,
      z.undefined(),
      GetMemoryUsageResponseSchema,
      undefined
    );
  },

  /**
   * Subscribe to file changed events (from watch mode).
   */
  onFileChanged: (callback: (event: FileChangedEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: unknown) => {
      const parsed = FileChangedEventSchema.safeParse(event);
      if (parsed.success) {
        callback(parsed.data);
      } else {
        console.error('Invalid file changed event from main process:', event);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.FILE_CHANGED, handler);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.FILE_CHANGED, handler);
    };
  },

  /**
   * Get watch status for sources.
   */
  getWatchStatus: (request?: GetWatchStatusRequest): Promise<GetWatchStatusResponse> => {
    return invoke(
      IPC_CHANNELS.GET_WATCH_STATUS,
      GetWatchStatusRequestSchema,
      GetWatchStatusResponseSchema,
      request || {}
    );
  },

  /**
   * Start watching a source directory.
   */
  startWatching: (request: StartWatchingRequest): Promise<StartWatchingResponse> => {
    return invoke(
      IPC_CHANNELS.START_WATCHING,
      StartWatchingRequestSchema,
      StartWatchingResponseSchema,
      request
    );
  },

  /**
   * Stop watching a source directory.
   */
  stopWatching: (request: StopWatchingRequest): Promise<StopWatchingResponse> => {
    return invoke(
      IPC_CHANNELS.STOP_WATCHING,
      StopWatchingRequestSchema,
      StopWatchingResponseSchema,
      request
    );
  },

  /**
   * Extract content from files using appropriate extractors.
   */
  extractContent: (request: ExtractContentRequest): Promise<ExtractContentResponse> => {
    return invoke(
      IPC_CHANNELS.EXTRACT_CONTENT,
      ExtractContentRequestSchema,
      ExtractContentResponseSchema,
      request
    );
  },

  /**
   * Subscribe to extraction progress updates.
   */
  onExtractionProgress: (callback: (progress: ExtractionProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => {
      const parsed = ExtractionProgressSchema.safeParse(progress);
      if (parsed.success) {
        callback(parsed.data);
      } else {
        console.error('Invalid extraction progress from main process:', progress);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.EXTRACTION_PROGRESS, handler);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.EXTRACTION_PROGRESS, handler);
    };
  },

  /**
   * Get extracted content for a file.
   */
  getFileContent: (request: GetFileContentRequest): Promise<GetFileContentResponse> => {
    return invoke(
      IPC_CHANNELS.GET_FILE_CONTENT,
      GetFileContentRequestSchema,
      GetFileContentResponseSchema,
      request
    );
  },

  /**
   * Get virtual tree structure.
   */
  getVirtualTree: (request?: GetVirtualTreeRequest): Promise<GetVirtualTreeResponse> => {
    return invoke(
      IPC_CHANNELS.GET_VIRTUAL_TREE,
      GetVirtualTreeRequestSchema,
      GetVirtualTreeResponseSchema,
      request || {}
    );
  },

  /**
   * Get children of a virtual folder path.
   */
  getVirtualChildren: (request: GetVirtualChildrenRequest): Promise<GetVirtualChildrenResponse> => {
    return invoke(
      IPC_CHANNELS.GET_VIRTUAL_CHILDREN,
      GetVirtualChildrenRequestSchema,
      GetVirtualChildrenResponseSchema,
      request
    );
  },

  /**
   * Run AI planner (taxonomy-driven virtual organization) for a source.
   */
  runPlanner: (request: RunPlannerRequest): Promise<RunPlannerResponse> => {
    return invoke(
      (IPC_CHANNELS as any).RUN_PLANNER,
      null,
      RunPlannerResponseSchema,
      request
    );
  },

  /**
   * Subscribe to planner progress updates.
   */
  onPlannerProgress: (callback: (progress: PlannerProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => {
      const parsed = PlannerProgressSchema.safeParse(progress);
      if (parsed.success) {
        callback(parsed.data);
      } else {
        console.error('Invalid planner progress from main process:', progress);
      }
    };
    ipcRenderer.on((IPC_CHANNELS as any).PLANNER_PROGRESS, handler);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener((IPC_CHANNELS as any).PLANNER_PROGRESS, handler);
    };
  },

  /**
   * Retrieve stored OpenAI API key status.
   */
  getApiKeyStatus: (): Promise<GetApiKeyStatusResponse> => {
    return invoke(IPC_CHANNELS.GET_API_KEY_STATUS, null, GetApiKeyStatusResponseSchema);
  },

  /**
   * Save or update the OpenAI API key.
   */
  saveApiKey: (request: SaveApiKeyRequest): Promise<SaveApiKeyResponse> => {
    return invoke(IPC_CHANNELS.SAVE_API_KEY, SaveApiKeyRequestSchema, SaveApiKeyResponseSchema, request);
  },

  /**
   * Delete the stored OpenAI API key.
   */
  deleteApiKey: (): Promise<DeleteApiKeyResponse> => {
    return invoke(IPC_CHANNELS.DELETE_API_KEY, null, DeleteApiKeyResponseSchema);
  },

  /**
   * Get the currently configured LLM model.
   */
  getLLMModel: (): Promise<GetLLMModelResponse> => {
    return invoke(IPC_CHANNELS.GET_LLM_MODEL, null, GetLLMModelResponseSchema);
  },

  /**
   * Save the LLM model configuration.
   */
  saveLLMModel: (request: SaveLLMModelRequest): Promise<SaveLLMModelResponse> => {
    return invoke(IPC_CHANNELS.SAVE_LLM_MODEL, SaveLLMModelRequestSchema, SaveLLMModelResponseSchema, request);
  },
};

// Expose to renderer via contextBridge
contextBridge.exposeInMainWorld('api', api);

// Type definition for the exposed API
export type Api = typeof api;
