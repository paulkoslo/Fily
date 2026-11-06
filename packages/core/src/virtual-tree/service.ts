import type { DatabaseManager } from '../db';
import { VIRTUAL_TREE_FULL_BUILD_MAX_FILES } from '../planner/constants';
import { VirtualTreeBuilder, type VirtualNode } from './index';

/** Shared by IPC and integration tests so both tree-loading strategies are exercised. */
export async function loadVirtualTree(db: DatabaseManager, sourceId?: number): Promise<VirtualNode> {
  const builder = new VirtualTreeBuilder();
  const totalCount = await db.getVirtualPlacementCount(sourceId);
  if (totalCount <= VIRTUAL_TREE_FULL_BUILD_MAX_FILES) {
    const placements = await db.getVirtualPlacements(sourceId);
    const records = await db.getFileRecordsByIds(placements.map((p) => p.file_id), sourceId);
    return builder.buildFromPlacements(placements, new Map(records.map((file) => [file.file_id, file])));
  }

  const folders = await db.getTopLevelVirtualFolders(sourceId);
  const tree = builder.buildTopLevelFromFolders(folders, totalCount);
  const rootPlacements = await db.getDirectVirtualFilePlacements('/', sourceId);
  const rootRecords = await db.getFileRecordsByIds(rootPlacements.map((p) => p.file_id), sourceId);
  const rootFiles = builder.buildFromPlacements(
    rootPlacements, new Map(rootRecords.map((file) => [file.file_id, file]))
  );
  // Both lists are already sorted; folders precede files just as in a full tree.
  tree.children.push(...rootFiles.children);
  return tree;
}
