import type { BrowserWindow, IpcMain } from 'electron';
import {
  IPC_CHANNELS,
  RunPlannerRequestSchema,
  RunOptimizerRequestSchema,
  TaxonomyPlanner,
  WorkerPool,
  PIPELINE_WORKER_POOL_MAX_WORKERS,
  type DatabaseManager,
  type FileRecord,
  type PlannerOutput,
  type PlannerProgress,
  type RunPlannerRequest,
  type RunPlannerResponse,
  type RunOptimizerRequest,
  type RunOptimizerResponse,
  type OptimizerProgress,
} from '@virtual-finder/core';

type MainWindowGetter = () => BrowserWindow | null;

export function registerPlannerHandlers(
  ipcMain: IpcMain,
  db: DatabaseManager,
  getMainWindow: MainWindowGetter
): void {
  // Run AI planner to generate virtual placements
  ipcMain.handle(
    IPC_CHANNELS.RUN_PLANNER,
    async (_event, request: unknown): Promise<RunPlannerResponse> => {
      const mainWindow = getMainWindow();

      const emitProgress = (
        progress: PlannerProgress & { step?: string; phase?: string; progressPercent?: number }
      ) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.PLANNER_PROGRESS, progress as PlannerProgress);
        }
      };

      try {
        const parsed = RunPlannerRequestSchema.safeParse(request);
        if (!parsed.success || typeof parsed.data.sourceId !== 'number') {
          return {
            success: false,
            filesPlanned: 0,
            error: 'sourceId is required to run planner',
          };
        }

        const req: RunPlannerRequest = parsed.data;
        const sourceId = parsed.data.sourceId!;
        const skipOptimization = req.skipOptimization === true;

        emitProgress({
          status: 'planning',
          filesTotal: 0,
          filesPlanned: 0,
          message: `Loading files for source ${sourceId}...`,
          step: `Step 3/4: Organizing files...`,
          phase: 'loading',
          progressPercent: 0,
        });

        const files: FileRecord[] = await db.getFilesBySource(sourceId, undefined, undefined, -1);

        if (files.length === 0) {
          emitProgress({
            status: 'done',
            filesTotal: 0,
            filesPlanned: 0,
            message: 'No files found to organize.',
            step: `Step 3/4: Organizing files...`,
            phase: 'done',
            progressPercent: 100,
          });
          return {
            success: true,
            filesPlanned: 0,
          };
        }

        emitProgress({
          status: 'planning',
          filesTotal: files.length,
          filesPlanned: 0,
          message: `Virtual file system is being created...`,
          step: `Step 3/4: Virtual file system is being created`,
        });

        const workerPool = new WorkerPool(PIPELINE_WORKER_POOL_MAX_WORKERS);

        const plannerProgress = (message: string) => {
          const isOptimizer = message.toLowerCase().includes('optimizer');
          const step = isOptimizer
            ? `Step 4/4: Optimizing low-confidence files...`
            : `Step 3/4: Virtual file system is being created`;

          emitProgress({
            status: 'planning',
            filesTotal: files.length,
            filesPlanned: 0,
            message,
            step,
          });
        };

        const planner = new TaxonomyPlanner(db, undefined, workerPool, plannerProgress);
        const outputs: PlannerOutput[] = await planner.plan(files, { skipOptimization });

        console.log(
          `[TaxonomyPlanner] Organized ${outputs.length.toLocaleString()} files using ${planner.id} v${planner.version}`
        );

        emitProgress({
          status: 'storing',
          filesTotal: outputs.length,
          filesPlanned: 0,
          message: `Virtual file system is being created...`,
          step: `Step 3/4: Virtual file system is being created`,
          phase: 'storing',
          progressPercent: 90,
        });

        await db.upsertVirtualPlacementBatch(outputs, planner.version);

        emitProgress({
          status: 'done',
          filesTotal: outputs.length,
          filesPlanned: outputs.length,
          message: 'AI virtual organization complete.',
          step: `Step 3/4: Organizing files...`,
          phase: 'done',
          progressPercent: 100,
        });

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
          step: `Step 3/4: Organizing files...`,
          phase: 'error',
          progressPercent: 0,
        });
        return {
          success: false,
          filesPlanned: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Run optimizer only (optimize existing low-confidence placements)
  ipcMain.handle(
    IPC_CHANNELS.RUN_OPTIMIZER,
    async (_event, request: unknown): Promise<RunOptimizerResponse> => {
      const mainWindow = getMainWindow();

      const emitProgress = (progress: OptimizerProgress & { step?: string; progressPercent?: number }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.OPTIMIZER_PROGRESS, progress as OptimizerProgress);
        }
      };

      try {
        const parsed = RunOptimizerRequestSchema.safeParse(request);
        if (!parsed.success || typeof parsed.data.sourceId !== 'number') {
          return {
            success: false,
            filesOptimized: 0,
            error: 'sourceId is required to run optimizer',
          };
        }

        const req: RunOptimizerRequest = parsed.data;
        const sourceId = req.sourceId!;

        emitProgress({
          status: 'optimizing',
          filesTotal: 0,
          filesOptimized: 0,
          message: `Loading existing placements for source ${sourceId}...`,
          step: `Optimizing low-confidence files...`,
          progressPercent: 0,
        });

        const workerPool = new WorkerPool(PIPELINE_WORKER_POOL_MAX_WORKERS);

        const optimizerProgress = (message: string) => {
          emitProgress({
            status: 'optimizing',
            filesTotal: 0,
            filesOptimized: 0,
            message,
            step: `Optimizing low-confidence files...`,
          });
        };

        const planner = new TaxonomyPlanner(db, undefined, workerPool, optimizerProgress);
        const outputs = await planner.optimizeExistingPlacements(sourceId);

        if (outputs.length === 0) {
          emitProgress({
            status: 'done',
            filesTotal: 0,
            filesOptimized: 0,
            message: 'No files to optimize.',
            step: `Optimizing low-confidence files...`,
            progressPercent: 100,
          });
          return {
            success: true,
            filesOptimized: 0,
          };
        }

        emitProgress({
          status: 'optimizing',
          filesTotal: outputs.length,
          filesOptimized: 0,
          message: `Storing optimized placements...`,
          step: `Optimizing low-confidence files...`,
          progressPercent: 90,
        });

        await db.upsertVirtualPlacementBatch(outputs, planner.version);

        const optimizedCount = outputs.length;

        emitProgress({
          status: 'done',
          filesTotal: outputs.length,
          filesOptimized: optimizedCount,
          message: `Optimized ${optimizedCount} file placements.`,
          step: `Optimizing low-confidence files...`,
          progressPercent: 100,
        });

        return {
          success: true,
          filesOptimized: optimizedCount,
        };
      } catch (error) {
        console.error('Error running optimizer:', error);
        emitProgress({
          status: 'error',
          filesTotal: 0,
          filesOptimized: 0,
          message: error instanceof Error ? error.message : 'Unknown optimizer error',
          step: `Optimizing low-confidence files...`,
          progressPercent: 0,
        });
        return {
          success: false,
          filesOptimized: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
