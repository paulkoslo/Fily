interface ProgressBarProps {
  progress: ExtractionProgress;
}

export function ProgressBar({ progress }: ProgressBarProps) {
  // Calculate progress percentage
  const getProgressPercent = (): number => {
    // Priority: Use step-based progress if available
    if (progress.totalSteps && progress.totalSteps > 0 && progress.currentStep !== undefined) {
      return Math.max(1, Math.round((progress.currentStep / progress.totalSteps) * 100));
    }
    // Fallback: Use file-based progress
    if (progress.filesTotal > 0) {
      return Math.max(1, Math.round((progress.filesProcessed / progress.filesTotal) * 100));
    }
    return 1;
  };

  const progressPercent = getProgressPercent();
  const isComplete = progress.status === 'done';

  return (
    <div className={`progress-banner ${isComplete ? 'progress-complete' : ''}`}>
      <div className="progress-content">
        <div className="progress-step-indicator">
          {isComplete 
            ? '✅ Step 2/3: Complete!' 
            : (progress.step || 'Step 2/3: Extracting content...')}
        </div>
        {!isComplete && (
          <div className="progress-details">
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{
                  width: `${progressPercent}%`,
                }}
              />
            </div>
            {progress.totalSteps && progress.totalSteps > 0 && progress.currentStep !== undefined ? (
              <span className="progress-count">
                {progress.currentStep} / {progress.totalSteps}
              </span>
            ) : progress.filesTotal > 0 ? (
              <span className="progress-count">
                {progress.filesProcessed} / {progress.filesTotal}
              </span>
            ) : null}
          </div>
        )}
        <div className="progress-status">
          <span className="progress-message">{progress.message}</span>
          {progress.currentFile && (
            <span className="progress-current-file" title={progress.currentFile}>
              {progress.currentFile}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
