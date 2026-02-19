import type { BrowserWindow, IpcMain } from 'electron';
import {
  IPC_CHANNELS,
  ExtractContentRequestSchema,
  GetFileContentRequestSchema,
  type DatabaseManager,
  type FileRecord,
  type ExtractContentResponse,
  type ExtractionProgress,
  type GetFileContentResponse,
} from '@virtual-finder/core';

type MainWindowGetter = () => BrowserWindow | null;

export function registerContentHandlers(
  ipcMain: IpcMain,
  db: DatabaseManager,
  getMainWindow: MainWindowGetter
): void {
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

        // Get files to extract (missing, failed, or stale content after file changes).
        let files: FileRecord[];
        if (sourceId !== undefined) {
          const fileIdsNeedingContent = new Set(await db.getFilesNeedingContent(sourceId));
          files = await db.getFilesBySource(sourceId, undefined, undefined, -1);
          files = files.filter((f) => fileIdsNeedingContent.has(f.file_id));
        } else {
          const sources = await db.getSources();
          const allFiles: FileRecord[] = [];
          for (const source of sources) {
            const fileIdsNeedingContent = new Set(await db.getFilesNeedingContent(source.id));
            const sourceFiles = await db.getFilesBySource(source.id, undefined, undefined, -1);
            allFiles.push(...sourceFiles.filter((f) => fileIdsNeedingContent.has(f.file_id)));
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

        // Let ContentService own detailed progress updates to avoid regressions.
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
}
