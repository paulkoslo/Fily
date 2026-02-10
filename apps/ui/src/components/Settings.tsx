import { useCallback, useEffect } from 'react';
import { themes, getAllThemeIds, type Theme } from '../themes';

interface SettingsProps {
  isOpen: boolean;
  currentThemeId: string;
  onClose: () => void;
  onThemeChange: (themeId: string) => void;
}

export function Settings({ isOpen, currentThemeId, onClose, onThemeChange }: SettingsProps) {
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const handleThemeSelect = useCallback(
    (themeId: string) => {
      onThemeChange(themeId);
    },
    [onThemeChange]
  );

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const themeIds = getAllThemeIds();

  return (
    <div className="settings-overlay" onClick={handleBackdropClick}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>
        <div className="settings-content">
          <div className="settings-section">
            <h3 className="settings-section-title">Theme</h3>
            <div className="theme-list">
              {themeIds.map((themeId) => {
                const theme = themes[themeId];
                const isSelected = themeId === currentThemeId;
                return (
                  <ThemeOption
                    key={themeId}
                    theme={theme}
                    themeId={themeId}
                    isSelected={isSelected}
                    onSelect={handleThemeSelect}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ThemeOptionProps {
  theme: Theme;
  themeId: string;
  isSelected: boolean;
  onSelect: (themeId: string) => void;
}

function ThemeOption({ theme, themeId, isSelected, onSelect }: ThemeOptionProps) {
  const handleClick = useCallback(() => {
    onSelect(themeId);
  }, [themeId, onSelect]);

  return (
    <div
      className={`theme-option ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div className="theme-preview">
        <div
          className={`theme-swatch ${theme.className}`}
          style={{
            backgroundColor: theme.variables['--bg-primary'],
            borderColor: theme.variables['--border-color'],
          }}
        >
          <div
            className="theme-swatch-secondary"
            style={{ backgroundColor: theme.variables['--bg-secondary'] }}
          />
          <div
            className="theme-swatch-accent"
            style={{ backgroundColor: theme.variables['--accent-color'] }}
          />
        </div>
      </div>
      <div className="theme-info">
        <span className="theme-name">{theme.name}</span>
      </div>
      {isSelected && <span className="theme-check">✓</span>}
    </div>
  );
}
