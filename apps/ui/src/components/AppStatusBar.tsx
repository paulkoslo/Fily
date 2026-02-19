import { MemoryInfo } from './MemoryInfo';

interface AppStatusBarProps {
  statusBarPath: string[];
}

export function AppStatusBar({ statusBarPath }: AppStatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-bar-path">
        {statusBarPath.map((segment, i) => (
          <span key={i} className="status-bar-path-segment">
            {i > 0 && <span className="status-bar-path-arrow">›</span>}
            {segment}
          </span>
        ))}
        {statusBarPath.length === 0 && <span className="status-bar-path-segment">—</span>}
      </div>
      <MemoryInfo />
    </footer>
  );
}
