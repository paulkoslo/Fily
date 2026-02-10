interface SettingsButtonProps {
  onClick: () => void;
  isActive?: boolean;
}

export function SettingsButton({ onClick, isActive }: SettingsButtonProps) {
  return (
    <button
      className={`settings-button ${isActive ? 'active' : ''}`}
      onClick={onClick}
      aria-label="Open settings"
      title="Settings"
    >
      ⚙️
    </button>
  );
}
