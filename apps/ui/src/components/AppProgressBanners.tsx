import { ProgressBar } from './ProgressBar';

interface AppProgressBannersProps {
  error: string | null;
  onDismissError: () => void;
  scanProgress: ScanProgress | null;
  extractionProgress: ExtractionProgress | null;
  plannerProgress: PlannerProgress | null;
  optimizerProgress: OptimizerProgress | null;
}

export function AppProgressBanners({
  error,
  onDismissError,
  scanProgress,
  extractionProgress,
  plannerProgress,
  optimizerProgress,
}: AppProgressBannersProps) {
  return (
    <>
      {error && (
        <div className="error-banner">
          <span className="error-message">{error}</span>
          <button className="error-dismiss" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      )}

      {scanProgress && scanProgress.status !== 'done' && (
        <div className="progress-banner">
          <div className="progress-content">
            <div className="progress-step-indicator">{scanProgress.step || 'Step 1/3: Scanning files...'}</div>
            {scanProgress.filesFound > 0 && scanProgress.status === 'indexing' ? (
              <div className="progress-details">
                <div className="progress-bar-container">
                  <div
                    className="progress-bar"
                    style={{
                      width: `${Math.round((scanProgress.filesProcessed / scanProgress.filesFound) * 100)}%`,
                    }}
                  />
                </div>
                <span className="progress-count">
                  {scanProgress.filesProcessed} / {scanProgress.filesFound}
                </span>
              </div>
            ) : (
              <div className="progress-details">
                <div className="progress-bar-container">
                  <div className="progress-bar-indeterminate" />
                </div>
              </div>
            )}
            <div className="progress-status">
              <span className="progress-message">{scanProgress.message}</span>
              {scanProgress.currentFile && (
                <span className="progress-current-file" title={scanProgress.currentFile}>
                  {scanProgress.currentFile}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {extractionProgress && <ProgressBar progress={extractionProgress} />}

      {plannerProgress && (
        <div className={`progress-banner ${plannerProgress.status === 'done' ? 'progress-complete' : ''}`}>
          <div className="progress-content">
            <div className="progress-step-indicator">
              {plannerProgress.status === 'done' ? 'Complete!' : plannerProgress.step || 'Step 3/4: Organizing files...'}
            </div>
            {plannerProgress.status !== 'done' ? (
              <div className="progress-details">
                <div className="progress-bar-container">
                  <div className="progress-bar-bouncing" />
                </div>
              </div>
            ) : null}
            <div className="progress-status">
              <span className="progress-message">{plannerProgress.message}</span>
            </div>
          </div>
        </div>
      )}

      {optimizerProgress && (
        <div className={`progress-banner ${optimizerProgress.status === 'done' ? 'progress-complete' : ''}`}>
          <div className="progress-content">
            <div className="progress-step-indicator">
              {optimizerProgress.status === 'done'
                ? '✅ Optimize: Complete!'
                : optimizerProgress.step || 'Optimizing low-confidence files...'}
            </div>
            {optimizerProgress.status !== 'done' ? (
              <div className="progress-details">
                <div className="progress-bar-container">
                  <div className="progress-bar-bouncing" />
                </div>
              </div>
            ) : null}
            <div className="progress-status">
              <span className="progress-message">{optimizerProgress.message}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
