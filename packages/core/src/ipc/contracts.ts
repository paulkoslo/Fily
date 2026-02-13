import { z } from 'zod';

// ============================================================================
// Folder Record Schema
// ============================================================================

export const FolderRecordSchema = z.object({
  id: z.number(),
  folder_id: z.string(), // sha1(path + mtime)
  path: z.string(),
  name: z.string(),
  relative_path: z.string(), // path relative to source root
  parent_path: z.string().nullable(), // parent folder's relative path (null for root)
  depth: z.number(), // 0 = direct child of source, 1 = grandchild, etc.
  source_id: z.number(),
  item_count: z.number(), // number of direct children (files + folders)
  mtime: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
});

export type FolderRecord = z.infer<typeof FolderRecordSchema>;

// ============================================================================
// File Record Schema
// ============================================================================

export const FileRecordSchema = z.object({
  id: z.number(),
  file_id: z.string(), // sha1(path + size + mtime)
  path: z.string(),
  name: z.string(),
  extension: z.string(),
  size: z.number(),
  mtime: z.number(), // Unix timestamp in ms
  source_id: z.number(),
  relative_path: z.string().nullable(), // path relative to source root
  parent_path: z.string().nullable(), // parent folder's relative path
  created_at: z.number(),
  updated_at: z.number(),
});

export type FileRecord = z.infer<typeof FileRecordSchema>;

// ============================================================================
// Source Schema
// ============================================================================

export const SourceSchema = z.object({
  id: z.number(),
  name: z.string(),
  path: z.string(),
  enabled: z.boolean(),
  created_at: z.number(),
  parent_source_id: z.number().nullable().optional(), // Links to parent source for virtual filesystem
});

export type Source = z.infer<typeof SourceSchema>;

// ============================================================================
// Planner Output Schema
// ============================================================================

export const PlannerOutputSchema = z.object({
  file_id: z.string(),
  virtual_path: z.string(),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

// ============================================================================
// Virtual Placement Schema (stored in DB)
// ============================================================================

export const VirtualPlacementSchema = z.object({
  id: z.number(),
  file_id: z.string(),
  virtual_path: z.string(),
  tags: z.string(), // JSON array stored as string
  confidence: z.number(),
  reason: z.string(),
  planner_version: z.string(),
  created_at: z.number(),
});

export type VirtualPlacement = z.infer<typeof VirtualPlacementSchema>;

// ============================================================================
// IPC Request/Response Schemas
// ============================================================================

// scanSource
export const ScanSourceRequestSchema = z.object({
  sourceId: z.number(),
});

export const ScanProgressSchema = z.object({
  status: z.enum(['scanning', 'indexing', 'cleaning', 'done', 'error']),
  currentFile: z.string().optional(),
  filesFound: z.number(),
  foldersFound: z.number().optional(),
  filesProcessed: z.number(),
  message: z.string(),
  step: z.string().optional(), // e.g., "Step 1/3: Scanning files..."
  phase: z.string().optional(), // e.g., "scanning", "indexing", "cleaning"
});

export const ScanSourceResponseSchema = z.object({
  success: z.boolean(),
  filesScanned: z.number(),
  filesRemoved: z.number().optional(),
  error: z.string().optional(),
});

export type ScanProgress = z.infer<typeof ScanProgressSchema>;
export type ScanSourceRequest = z.infer<typeof ScanSourceRequestSchema>;
export type ScanSourceResponse = z.infer<typeof ScanSourceResponseSchema>;

// listFiles
export const ListFilesRequestSchema = z.object({
  sourceId: z.number(),
  query: z.string().optional(),
  parentPath: z.string().nullable().optional(),
  limit: z.number().optional(), // Page size (default 100)
  offset: z.number().optional(), // Pagination offset (default 0)
});

export const ListFilesResponseSchema = z.object({
  success: z.boolean(),
  files: z.array(FileRecordSchema),
  error: z.string().optional(),
});

export type ListFilesRequest = z.infer<typeof ListFilesRequestSchema>;
export type ListFilesResponse = z.infer<typeof ListFilesResponseSchema>;

// smartSearchFiles - ranked search with filename > summary > tags priority
export const SmartSearchFilesRequestSchema = z.object({
  query: z.string().min(1), // Required, non-empty query
  sourceId: z.number().optional(), // Optional: search within specific source, or all sources if omitted
  limit: z.number().optional().default(20), // Max results to return
});

export const SmartSearchResultSchema = z.object({
  file_id: z.string(),
  name: z.string(),
  path: z.string(),
  relative_path: z.string().nullable(),
  parent_path: z.string().nullable(), // Parent folder path for filesystem navigation
  extension: z.string(),
  size: z.number(),
  mtime: z.number(),
  source_id: z.number(),
  match_type: z.enum(['filename', 'summary', 'tags']), // Which field matched
  match_score: z.number(), // Higher = better match (for sorting)
  summary: z.string().nullable(), // Include summary for display
  tags: z.array(z.string()).optional(), // Include tags for display
  virtual_path: z.string().nullable(), // Virtual path if file is organized
});

export const SmartSearchFilesResponseSchema = z.object({
  success: z.boolean(),
  results: z.array(SmartSearchResultSchema),
  error: z.string().optional(),
});

export type SmartSearchFilesRequest = z.infer<typeof SmartSearchFilesRequestSchema>;
export type SmartSearchFilesResponse = z.infer<typeof SmartSearchFilesResponseSchema>;
export type SmartSearchResult = z.infer<typeof SmartSearchResultSchema>;

// openFile
export const OpenFileRequestSchema = z.object({
  path: z.string(),
});

export const OpenFileResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

export type OpenFileRequest = z.infer<typeof OpenFileRequestSchema>;
export type OpenFileResponse = z.infer<typeof OpenFileResponseSchema>;

// getSources
export const GetSourcesResponseSchema = z.object({
  success: z.boolean(),
  sources: z.array(SourceSchema),
  error: z.string().optional(),
});

export type GetSourcesResponse = z.infer<typeof GetSourcesResponseSchema>;

// ============================================================================
// IPC Channel Names
// ============================================================================

// listFolders
export const ListFoldersRequestSchema = z.object({
  sourceId: z.number(),
  parentPath: z.string().nullable().optional(), // null for root level, string for subfolder
  query: z.string().optional(), // search query
});

export const ListFoldersResponseSchema = z.object({
  success: z.boolean(),
  folders: z.array(FolderRecordSchema),
  error: z.string().optional(),
});

export type ListFoldersRequest = z.infer<typeof ListFoldersRequestSchema>;
export type ListFoldersResponse = z.infer<typeof ListFoldersResponseSchema>;

// getFolderTree (full tree for AI context)
export const GetFolderTreeResponseSchema = z.object({
  success: z.boolean(),
  folders: z.array(FolderRecordSchema),
  totalFiles: z.number(),
  totalFolders: z.number(),
  error: z.string().optional(),
});

export type GetFolderTreeResponse = z.infer<typeof GetFolderTreeResponseSchema>;

// addSource
export const AddSourceRequestSchema = z.object({
  name: z.string(),
  path: z.string(),
});

export const AddSourceResponseSchema = z.object({
  success: z.boolean(),
  source: SourceSchema.optional(),
  error: z.string().optional(),
});

export type AddSourceRequest = z.infer<typeof AddSourceRequestSchema>;
export type AddSourceResponse = z.infer<typeof AddSourceResponseSchema>;

// selectFolder (opens native dialog)
export const SelectFolderResponseSchema = z.object({
  success: z.boolean(),
  path: z.string().optional(),
  name: z.string().optional(),
  cancelled: z.boolean().optional(),
  error: z.string().optional(),
});

export type SelectFolderResponse = z.infer<typeof SelectFolderResponseSchema>;

// removeSource
export const RemoveSourceRequestSchema = z.object({
  sourceId: z.number(),
});

export const RemoveSourceResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

export type RemoveSourceRequest = z.infer<typeof RemoveSourceRequestSchema>;
export type RemoveSourceResponse = z.infer<typeof RemoveSourceResponseSchema>;

// previewSourceDeletion
export const PreviewSourceDeletionRequestSchema = z.object({
  sourceId: z.number(),
});

export const PreviewSourceDeletionResponseSchema = z.object({
  success: z.boolean(),
  fileCount: z.number().optional(),
  folderCount: z.number().optional(),
  virtualPlacementCount: z.number().optional(),
  fileContentCount: z.number().optional(),
  eventCount: z.number().optional(),
  childSourceCount: z.number().optional(),
  sourceName: z.string().optional(),
  sourcePath: z.string().optional(),
  error: z.string().optional(),
});

export type PreviewSourceDeletionRequest = z.infer<typeof PreviewSourceDeletionRequestSchema>;
export type PreviewSourceDeletionResponse = z.infer<typeof PreviewSourceDeletionResponseSchema>;

// getMemoryUsage
export const MemoryUsageSchema = z.object({
  heapUsed: z.number(),
  heapTotal: z.number(),
  external: z.number(),
  rss: z.number(),
});

export const GetMemoryUsageResponseSchema = z.object({
  success: z.boolean(),
  memory: MemoryUsageSchema.optional(),
  error: z.string().optional(),
});

export type MemoryUsage = z.infer<typeof MemoryUsageSchema>;
export type GetMemoryUsageResponse = z.infer<typeof GetMemoryUsageResponseSchema>;

// File changed event (emitted from main to renderer)
export const FileChangedEventSchema = z.object({
  sourceId: z.number(),
  type: z.enum(['add', 'change', 'unlink']),
  path: z.string(),
  timestamp: z.number(),
});

export type FileChangedEvent = z.infer<typeof FileChangedEventSchema>;

// Watch status request/response
export const GetWatchStatusRequestSchema = z.object({
  sourceId: z.number().optional(),
});

export const GetWatchStatusResponseSchema = z.object({
  success: z.boolean(),
  watching: z.boolean(),
  sourceIds: z.array(z.number()),
  error: z.string().optional(),
});

export type GetWatchStatusRequest = z.infer<typeof GetWatchStatusRequestSchema>;
export type GetWatchStatusResponse = z.infer<typeof GetWatchStatusResponseSchema>;

// Start watching request/response
export const StartWatchingRequestSchema = z.object({
  sourceId: z.number(),
});

export const StartWatchingResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

export type StartWatchingRequest = z.infer<typeof StartWatchingRequestSchema>;
export type StartWatchingResponse = z.infer<typeof StartWatchingResponseSchema>;

// Stop watching request/response
export const StopWatchingRequestSchema = z.object({
  sourceId: z.number(),
});

export const StopWatchingResponseSchema = z.object({
  success: z.boolean(),
});

export type StopWatchingRequest = z.infer<typeof StopWatchingRequestSchema>;
export type StopWatchingResponse = z.infer<typeof StopWatchingResponseSchema>;

// extractContent
export const ExtractContentRequestSchema = z.object({
  sourceId: z.number().optional(),
});

export const ExtractionProgressSchema = z.object({
  status: z.enum(['scanning', 'extracting', 'done', 'error']),
  filesProcessed: z.number(),
  filesTotal: z.number(),
  currentFile: z.string(),
  message: z.string(),
  step: z.string().optional(), // e.g., "Step 1/3: Scanning files..." or "Step 2/3: Extracting content..."
  phase: z.string().optional(), // e.g., "scanning", "extracting", "summarizing", "tagging", "storing"
  // Progress tracking: scanning (1 step) + batches (creation + completion)
  totalSteps: z.number().optional(), // Total steps: 1 (scanning) + batchesTotal * 2
  currentStep: z.number().optional(), // Current step (0-based)
  batchesTotal: z.number().optional(), // Total number of batches
  batchesSent: z.number().optional(), // Number of batches sent (creation step)
  batchesCompleted: z.number().optional(), // Number of batches completed (completion step)
});

export const ExtractContentResponseSchema = z.object({
  success: z.boolean(),
  filesProcessed: z.number(),
  errors: z.number(),
  error: z.string().optional(),
});

export type ExtractContentRequest = z.infer<typeof ExtractContentRequestSchema>;
export type ExtractionProgress = z.infer<typeof ExtractionProgressSchema>;
export type ExtractContentResponse = z.infer<typeof ExtractContentResponseSchema>;

// runPlanner (AI virtual organization)
export const RunPlannerRequestSchema = z.object({
  sourceId: z.number().optional(),
  skipOptimization: z.boolean().optional(), // If true, skip optimizer step (for "Organize only" mode)
});

export const PlannerProgressSchema = z.object({
  status: z.enum(['planning', 'storing', 'done', 'error']),
  filesTotal: z.number(),
  filesPlanned: z.number(),
  message: z.string(),
  step: z.string().optional(), // e.g., "Step 3/3: Organizing files..."
  phase: z.string().optional(), // e.g., "loading", "planning", "applying", "storing"
  progressPercent: z.number().optional(), // 0-100 for planning phase
});

export const RunPlannerResponseSchema = z.object({
  success: z.boolean(),
  filesPlanned: z.number(),
  error: z.string().optional(),
});

export type RunPlannerRequest = z.infer<typeof RunPlannerRequestSchema>;
export type PlannerProgress = z.infer<typeof PlannerProgressSchema>;
export type RunPlannerResponse = z.infer<typeof RunPlannerResponseSchema>;

// runOptimizer (optimize low-confidence files only)
export const RunOptimizerRequestSchema = z.object({
  sourceId: z.number().optional(),
});

export const OptimizerProgressSchema = z.object({
  status: z.enum(['optimizing', 'done', 'error']),
  filesTotal: z.number(),
  filesOptimized: z.number(),
  message: z.string(),
  step: z.string().optional(),
  progressPercent: z.number().optional(),
});

export const RunOptimizerResponseSchema = z.object({
  success: z.boolean(),
  filesOptimized: z.number(),
  error: z.string().optional(),
});

export type RunOptimizerRequest = z.infer<typeof RunOptimizerRequestSchema>;
export type OptimizerProgress = z.infer<typeof OptimizerProgressSchema>;
export type RunOptimizerResponse = z.infer<typeof RunOptimizerResponseSchema>;

// getFileContent
export const GetFileContentRequestSchema = z.object({
  fileId: z.string(),
});

export const FileContentSchema = z.object({
  file_id: z.string(),
  content_type: z.string(),
  extracted_text: z.string().nullable(),
  summary: z.string().nullable(),
  keywords: z.string(), // JSON string
  tags: z.string().nullable(), // JSON string array (from Tag Agent)
  metadata: z.string().nullable(), // JSON string
  extracted_at: z.number(),
  extractor_version: z.string(),
  error_message: z.string().nullable(),
});

export const GetFileContentResponseSchema = z.object({
  success: z.boolean(),
  content: FileContentSchema.nullable(),
  error: z.string().optional(),
});

export type GetFileContentRequest = z.infer<typeof GetFileContentRequestSchema>;
export type FileContent = z.infer<typeof FileContentSchema>;
export type GetFileContentResponse = z.infer<typeof GetFileContentResponseSchema>;

// ============================================================================
// File Card Schema (file + AI metadata view for planners/agents)
// ============================================================================

export const FileCardSchema = z.object({
  file_id: z.string(),
  source_id: z.number(),
  path: z.string(),
  relative_path: z.string().nullable(),
  name: z.string(),
  extension: z.string(),
  size: z.number(),
  mtime: z.number(),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
});

export type FileCard = z.infer<typeof FileCardSchema>;

// getVirtualTree
export const GetVirtualTreeRequestSchema = z.object({
  sourceId: z.number().optional(),
});

// Note: VirtualNode type is exported from virtual-tree/index.ts
// We use a simplified schema here for IPC validation
export const VirtualNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    type: z.enum(['folder', 'file']),
    children: z.array(VirtualNodeSchema),
    fileRecord: FileRecordSchema.optional(),
    placement: PlannerOutputSchema.optional(),
  })
);

export const GetVirtualTreeResponseSchema = z.object({
  success: z.boolean(),
  tree: VirtualNodeSchema.optional(),
  error: z.string().optional(),
});

export type GetVirtualTreeRequest = z.infer<typeof GetVirtualTreeRequestSchema>;
export type GetVirtualTreeResponse = z.infer<typeof GetVirtualTreeResponseSchema>;

// getVirtualChildren
export const GetVirtualChildrenRequestSchema = z.object({
  virtualPath: z.string(),
  sourceId: z.number().optional(),
});

export const GetVirtualChildrenResponseSchema = z.object({
  success: z.boolean(),
  children: z.array(VirtualNodeSchema),
  error: z.string().optional(),
});

export type GetVirtualChildrenRequest = z.infer<typeof GetVirtualChildrenRequestSchema>;
export type GetVirtualChildrenResponse = z.infer<typeof GetVirtualChildrenResponseSchema>;

// API key management
export const ApiKeyTypeSchema = z.enum(['openrouter', 'openai']);
export type ApiKeyType = z.infer<typeof ApiKeyTypeSchema>;

export const ApiKeyStatusSchema = z.object({
  hasKey: z.boolean(),
  maskedKey: z.string().optional(),
  provider: ApiKeyTypeSchema.optional(),
});

export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

export const MultiApiKeyStatusSchema = z.object({
  openrouter: ApiKeyStatusSchema,
  openai: ApiKeyStatusSchema,
  activeProvider: ApiKeyTypeSchema.nullable(),
});

export type MultiApiKeyStatus = z.infer<typeof MultiApiKeyStatusSchema>;

export const GetApiKeyStatusResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  multiStatus: MultiApiKeyStatusSchema.optional(),
}).and(ApiKeyStatusSchema);

export type GetApiKeyStatusResponse = z.infer<typeof GetApiKeyStatusResponseSchema>;

export const SaveApiKeyRequestSchema = z.object({
  apiKey: z.string().min(10, 'API key must be at least 10 characters'),
  keyType: ApiKeyTypeSchema.optional().default('openai'),
});

export const SaveApiKeyResponseSchema = z.object({
  success: z.boolean(),
  status: ApiKeyStatusSchema.optional(),
  error: z.string().optional(),
});

export type SaveApiKeyRequest = z.infer<typeof SaveApiKeyRequestSchema>;
export type SaveApiKeyResponse = z.infer<typeof SaveApiKeyResponseSchema>;

export const DeleteApiKeyRequestSchema = z.object({
  keyType: ApiKeyTypeSchema.optional(),
});

export type DeleteApiKeyRequest = z.infer<typeof DeleteApiKeyRequestSchema>;

export const DeleteApiKeyResponseSchema = z.object({
  success: z.boolean(),
  status: ApiKeyStatusSchema.optional(),
  multiStatus: MultiApiKeyStatusSchema.optional(),
  error: z.string().optional(),
});

export type DeleteApiKeyResponse = z.infer<typeof DeleteApiKeyResponseSchema>;

// LLM Model settings
export const LLMModelSchema = z.enum([
  'openai/gpt-5-nano',
  'openai/gpt-5-mini',
  'x-ai/grok-4.1-fast',
  'deepseek/deepseek-v3.2',
]);

export type LLMModel = z.infer<typeof LLMModelSchema>;

export const GetLLMModelResponseSchema = z.object({
  success: z.boolean(),
  model: LLMModelSchema.nullable(),
  error: z.string().optional(),
});

export type GetLLMModelResponse = z.infer<typeof GetLLMModelResponseSchema>;

export const SaveLLMModelRequestSchema = z.object({
  model: LLMModelSchema,
});

export type SaveLLMModelRequest = z.infer<typeof SaveLLMModelRequestSchema>;

export const SaveLLMModelResponseSchema = z.object({
  success: z.boolean(),
  model: LLMModelSchema.optional(),
  error: z.string().optional(),
});

export type SaveLLMModelResponse = z.infer<typeof SaveLLMModelResponseSchema>;

export const IPC_CHANNELS = {
  SCAN_SOURCE: 'scan-source',
  SCAN_PROGRESS: 'scan-progress',
  LIST_FILES: 'list-files',
  SMART_SEARCH_FILES: 'smart-search-files',
  LIST_FOLDERS: 'list-folders',
  GET_FOLDER_TREE: 'get-folder-tree',
  OPEN_FILE: 'open-file',
  OPEN_FOLDER: 'open-folder',
  GET_SOURCES: 'get-sources',
  ADD_SOURCE: 'add-source',
  SELECT_FOLDER: 'select-folder',
  REMOVE_SOURCE: 'remove-source',
  PREVIEW_SOURCE_DELETION: 'preview-source-deletion',
  GET_MEMORY_USAGE: 'get-memory-usage',
  FILE_CHANGED: 'file-changed',
  GET_WATCH_STATUS: 'get-watch-status',
  START_WATCHING: 'start-watching',
  STOP_WATCHING: 'stop-watching',
  EXTRACT_CONTENT: 'extract-content',
  EXTRACTION_PROGRESS: 'extraction-progress',
  GET_FILE_CONTENT: 'get-file-content',
  GET_VIRTUAL_TREE: 'get-virtual-tree',
  GET_VIRTUAL_CHILDREN: 'get-virtual-children',
  RUN_PLANNER: 'run-planner',
  PLANNER_PROGRESS: 'planner-progress',
  RUN_OPTIMIZER: 'run-optimizer',
  OPTIMIZER_PROGRESS: 'optimizer-progress',
  GET_API_KEY_STATUS: 'get-api-key-status',
  SAVE_API_KEY: 'save-api-key',
  DELETE_API_KEY: 'delete-api-key',
  GET_LLM_MODEL: 'get-llm-model',
  SAVE_LLM_MODEL: 'save-llm-model',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
