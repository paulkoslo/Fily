import type { IpcMain } from 'electron';
import {
  IPC_CHANNELS,
  GetVirtualTreeRequestSchema,
  GetVirtualChildrenRequestSchema,
  VirtualTreeBuilder,
  type DatabaseManager,
  type FileRecord,
  type VirtualNode,
  type GetVirtualTreeResponse,
  type GetVirtualChildrenResponse,
} from '@virtual-finder/core';

export function registerVirtualTreeHandlers(
  ipcMain: IpcMain,
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

        const totalStartTime = Date.now();
        console.log(`[Performance] Starting virtual tree load for source ${sourceId || 'all'}...`);

        // Check total count first to decide if we need optimized queries
        const countStartTime = Date.now();
        const totalCount = await db.getVirtualPlacementCount(sourceId);
        const countTime = Date.now() - countStartTime;
        console.log(
          `[Performance] Total virtual placements count: ${totalCount.toLocaleString()} (queried in ${countTime}ms)`
        );

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

        let tree: VirtualNode;
        if (totalCount > 10000) {
          // Large dataset: use optimized queries (only top-level placements)
          const placementsStartTime = Date.now();
          const topLevelPlacements = await db.getTopLevelVirtualPlacements(sourceId);
          const placementsTime = Date.now() - placementsStartTime;
          console.log(
            `[Performance] Loaded ${topLevelPlacements.length.toLocaleString()} top-level placements in ${placementsTime}ms (optimized query)`
          );

          tree = builder.buildTopLevelOnly(topLevelPlacements, totalCount);
          const buildTime = Date.now() - buildStartTime;
          const totalTime = Date.now() - totalStartTime;
          console.log(`[Performance] Built top-level tree structure in ${buildTime}ms (lazy loading enabled)`);
          console.log(
            `[Performance] Total virtual tree load time: ${totalTime}ms (skipped loading ${(totalCount - topLevelPlacements.length).toLocaleString()} deep placements)`
          );
        } else {
          // Small dataset: load all placements and build full tree immediately
          const placementsStartTime = Date.now();
          const placements = await db.getVirtualPlacements(sourceId);
          const placementsTime = Date.now() - placementsStartTime;
          console.log(`[Performance] Loaded ${placements.length.toLocaleString()} virtual placements in ${placementsTime}ms`);

          const fileRecordsMap = new Map<string, FileRecord>();
          if (placements.length > 0) {
            const fileLoadStartTime = Date.now();
            const fileRecords = await db.getFileRecordsForVirtualPlacements(sourceId);
            for (const record of fileRecords) {
              fileRecordsMap.set(record.file_id, record);
            }
            const fileLoadTime = Date.now() - fileLoadStartTime;
            console.log(
              `[Performance] Loaded ${fileRecordsMap.size.toLocaleString()} file records via DB helper in ${fileLoadTime}ms`
            );
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
