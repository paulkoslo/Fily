import type { IpcMain } from 'electron';
import {
  IPC_CHANNELS,
  GetVirtualTreeRequestSchema,
  GetVirtualChildrenRequestSchema,
  loadVirtualTree,
  type DatabaseManager,
  type FileRecord,
  type VirtualNode,
  type GetVirtualTreeResponse,
  type GetVirtualChildrenResponse,
} from '@virtual-finder/core';

export function registerVirtualTreeHandlers(
  ipcMain: Pick<IpcMain, 'handle'>,
  db: DatabaseManager
): void {
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

        const tree = await loadVirtualTree(db, sourceId);

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

        // Load only direct children (folders + files), avoiding full subtree rebuilds.
        const [folderPaths, filePlacements] = await Promise.all([
          db.getDirectVirtualFolderPaths(virtualPath, sourceId),
          db.getDirectVirtualFilePlacements(virtualPath, sourceId),
        ]);

        if (folderPaths.length === 0 && filePlacements.length === 0) {
          return {
            success: true,
            children: [],
          };
        }

        const fileIds = filePlacements.map((p) => p.file_id);
        const fileRecords = await db.getFileRecordsByIds(fileIds, sourceId);
        const fileRecordMap = new Map(fileRecords.map((f) => [f.file_id, f]));

        const folderChildren = folderPaths.map((folderPath) => {
          const pathParts = folderPath.split('/').filter(Boolean);
          const folderName = pathParts[pathParts.length - 1] || folderPath;
          return {
            id: `folder:${folderPath}`,
            name: folderName,
            path: folderPath,
            type: 'folder' as const,
            children: [],
          };
        });

        const fileChildren = filePlacements
          .map((placement) => {
            const fileRecord = fileRecordMap.get(placement.file_id);
            if (!fileRecord) {
              return null;
            }

            let parsedTags: string[] = [];
            try {
              const value = JSON.parse(placement.tags);
              if (Array.isArray(value)) {
                parsedTags = value.filter((t) => typeof t === 'string');
              }
            } catch {
              parsedTags = [];
            }

            const fileNameFromPath =
              placement.virtual_path.split('/').filter(Boolean).pop() || fileRecord.name;

            return {
              id: `file:${placement.file_id}`,
              name: fileNameFromPath,
              path: placement.virtual_path,
              type: 'file' as const,
              children: [],
              fileRecord,
              placement: {
                file_id: placement.file_id,
                virtual_path: placement.virtual_path,
                tags: parsedTags,
                confidence: placement.confidence,
                reason: placement.reason,
              },
            };
          })
          .filter((node): node is NonNullable<typeof node> => node !== null);

        const children = [...folderChildren, ...fileChildren].sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
          }
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

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
}
