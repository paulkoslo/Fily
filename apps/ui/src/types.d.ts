// Type definitions for the API exposed by preload script
// These are global types available throughout the UI app

declare global {
  interface Source {
    id: number;
    name: string;
    path: string;
    enabled: boolean;
    created_at: number;
  }

  interface FolderRecord {
    id: number;
    folder_id: string;
    path: string;
    name: string;
    relative_path: string;
    parent_path: string | null;
    depth: number;
    source_id: number;
    item_count: number;
    mtime: number;
    created_at: number;
    updated_at: number;
  }

  interface FileRecord {
    id: number;
    file_id: string;
    path: string;
    name: string;
    extension: string;
    size: number;
    mtime: number;
    source_id: number;
    relative_path: string | null;
    parent_path: string | null;
    created_at: number;
    updated_at: number;
  }

  interface ScanProgress {
    status: 'scanning' | 'indexing' | 'cleaning' | 'done' | 'error';
    currentFile?: string;
    filesFound: number;
    foldersFound?: number;
    filesProcessed: number;
    message: string;
  }

  interface ScanSourceRequest {
    sourceId: number;
  }

  interface ScanSourceResponse {
    success: boolean;
    filesScanned: number;
    filesRemoved?: number;
    error?: string;
  }

  interface ListFilesRequest {
    sourceId: number;
    query?: string;
    parentPath?: string | null;
    limit?: number; // Page size (default 100)
    offset?: number; // Pagination offset (default 0)
  }

  interface ListFilesResponse {
    success: boolean;
    files: FileRecord[];
    error?: string;
  }

  interface ListFoldersRequest {
    sourceId: number;
    parentPath?: string | null;
    query?: string;
  }

  interface ListFoldersResponse {
    success: boolean;
    folders: FolderRecord[];
    error?: string;
  }

  interface GetFolderTreeResponse {
    success: boolean;
    folders: FolderRecord[];
    totalFiles: number;
    totalFolders: number;
    error?: string;
  }

  interface OpenFileRequest {
    path: string;
  }

  interface OpenFileResponse {
    success: boolean;
    error?: string;
  }

  interface GetSourcesResponse {
    success: boolean;
    sources: Source[];
    error?: string;
  }

  interface AddSourceRequest {
    name: string;
    path: string;
  }

  interface AddSourceResponse {
    success: boolean;
    source?: Source;
    error?: string;
  }

  interface SelectFolderResponse {
    success: boolean;
    path?: string;
    name?: string;
    cancelled?: boolean;
    error?: string;
  }

  interface RemoveSourceRequest {
    sourceId: number;
  }

  interface RemoveSourceResponse {
    success: boolean;
    error?: string;
  }

  interface PreviewSourceDeletionRequest {
    sourceId: number;
  }

  interface PreviewSourceDeletionResponse {
    success: boolean;
    fileCount?: number;
    folderCount?: number;
    virtualPlacementCount?: number;
    sourceName?: string;
    sourcePath?: string;
    error?: string;
  }

  interface MemoryUsage {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  }

  interface GetMemoryUsageResponse {
    success: boolean;
    memory?: MemoryUsage;
    error?: string;
  }

  interface FileChangedEvent {
    sourceId: number;
    type: 'add' | 'change' | 'unlink';
    path: string;
    timestamp: number;
  }

  interface GetWatchStatusRequest {
    sourceId?: number;
  }

  interface GetWatchStatusResponse {
    success: boolean;
    watching: boolean;
    sourceIds: number[];
    error?: string;
  }

  interface StartWatchingRequest {
    sourceId: number;
  }

  interface StartWatchingResponse {
    success: boolean;
    error?: string;
  }

  interface StopWatchingRequest {
    sourceId: number;
  }

  interface StopWatchingResponse {
    success: boolean;
  }

  interface ExtractContentRequest {
    sourceId?: number;
  }

  interface ExtractionProgress {
    status: 'extracting' | 'done' | 'error';
    filesProcessed: number;
    filesTotal: number;
    currentFile: string;
    message: string;
  }

  interface ExtractContentResponse {
    success: boolean;
    filesProcessed: number;
    errors: number;
    error?: string;
  }

  interface RunPlannerRequest {
    sourceId?: number;
  }

  interface PlannerProgress {
    status: 'planning' | 'storing' | 'done' | 'error';
    filesTotal: number;
    filesPlanned: number;
    message: string;
  }

  interface RunPlannerResponse {
    success: boolean;
    filesPlanned: number;
    error?: string;
  }

  interface VirtualNode {
    id: string;
    name: string;
    path: string;
    type: 'folder' | 'file';
    children: VirtualNode[];
    fileRecord?: FileRecord;
    placement?: {
      file_id: string;
      virtual_path: string;
      tags: string[];
      confidence: number;
      reason: string;
    };
    // Only present for folder nodes - pre-computed count of all files in subtree
    fileCount?: number;
  }

  interface GetVirtualTreeRequest {
    sourceId?: number;
  }

  interface GetVirtualTreeResponse {
    success: boolean;
    tree?: VirtualNode;
    error?: string;
  }

  interface GetVirtualChildrenRequest {
    virtualPath: string;
    sourceId?: number;
  }

  interface GetVirtualChildrenResponse {
    success: boolean;
    children: VirtualNode[];
    error?: string;
  }

  interface FileContent {
    file_id: string;
    content_type: string;
    extracted_text: string | null;
    summary: string | null;
    keywords: string; // JSON string
    tags: string | null; // JSON string array (from Tag Agent)
    metadata: string | null; // JSON string
    extracted_at: number;
    extractor_version: string;
    error_message: string | null;
  }

  interface GetFileContentRequest {
    fileId: string;
  }

  interface GetFileContentResponse {
    success: boolean;
    content: FileContent | null;
    error?: string;
  }

  interface Api {
    getSources: () => Promise<GetSourcesResponse>;
    selectFolder: () => Promise<SelectFolderResponse>;
    addSource: (request: AddSourceRequest) => Promise<AddSourceResponse>;
    previewSourceDeletion: (request: PreviewSourceDeletionRequest) => Promise<PreviewSourceDeletionResponse>;
    removeSource: (request: RemoveSourceRequest) => Promise<RemoveSourceResponse>;
    scanSource: (request: ScanSourceRequest) => Promise<ScanSourceResponse>;
    onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
    listFiles: (request: ListFilesRequest) => Promise<ListFilesResponse>;
    listFolders: (request: ListFoldersRequest) => Promise<ListFoldersResponse>;
    getFolderTree: (request: ListFoldersRequest) => Promise<GetFolderTreeResponse>;
    openFile: (request: OpenFileRequest) => Promise<OpenFileResponse>;
    openFolder: (request: OpenFileRequest) => Promise<OpenFileResponse>;
    getMemoryUsage: () => Promise<GetMemoryUsageResponse>;
    onFileChanged: (callback: (event: FileChangedEvent) => void) => () => void;
    getWatchStatus: (request?: GetWatchStatusRequest) => Promise<GetWatchStatusResponse>;
    startWatching: (request: StartWatchingRequest) => Promise<StartWatchingResponse>;
    stopWatching: (request: StopWatchingRequest) => Promise<StopWatchingResponse>;
    extractContent: (request: ExtractContentRequest) => Promise<ExtractContentResponse>;
    onExtractionProgress: (callback: (progress: ExtractionProgress) => void) => () => void;
    getFileContent: (request: GetFileContentRequest) => Promise<GetFileContentResponse>;
    getVirtualTree: (request?: GetVirtualTreeRequest) => Promise<GetVirtualTreeResponse>;
    getVirtualChildren: (request: GetVirtualChildrenRequest) => Promise<GetVirtualChildrenResponse>;
    runPlanner: (request: RunPlannerRequest) => Promise<RunPlannerResponse>;
    onPlannerProgress: (callback: (progress: PlannerProgress) => void) => () => void;
  }

  interface Window {
    api: Api;
  }
}

export {};
