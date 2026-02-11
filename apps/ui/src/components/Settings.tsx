import { useCallback, useEffect, useState } from 'react';
import { themes, getAllThemeIds, type Theme } from '../themes';

/** Available models for selection */
const AVAILABLE_MODELS: { id: LLMModel; name: string; provider: string }[] = [
  { id: 'openai/gpt-5-nano', name: 'GPT-5 Nano (Fast & Cheap)', provider: 'OpenAI' },
  { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini (Balanced)', provider: 'OpenAI' },
  { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast', provider: 'xAI' },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', provider: 'DeepSeek' },
];

interface SettingsProps {
  isOpen: boolean;
  currentThemeId: string;
  onClose: () => void;
  onThemeChange: (themeId: string) => void;
  apiKeyStatus: ApiKeyStatus | null;
  apiKeyError: string | null;
  isApiKeyBusy: boolean;
  onSaveApiKey: (apiKey: string) => Promise<boolean>;
  onDeleteApiKey: () => Promise<boolean>;
  currentModel: LLMModel | null;
  onModelChange: (model: LLMModel) => Promise<boolean>;
  isModelBusy: boolean;
}

export function Settings({
  isOpen,
  currentThemeId,
  onClose,
  onThemeChange,
  apiKeyStatus,
  apiKeyError,
  isApiKeyBusy,
  onSaveApiKey,
  onDeleteApiKey,
  currentModel,
  onModelChange,
  isModelBusy,
}: SettingsProps) {
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(currentModel);

  // Sync selected model with prop
  useEffect(() => {
    setSelectedModel(currentModel);
  }, [currentModel]);

  useEffect(() => {
    if (!isOpen) {
      setIsEditingKey(false);
      setApiKeyInput('');
    }
  }, [isOpen]);

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

  const handleSubmitApiKey = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const value = apiKeyInput.trim();
      if (!value) {
        return;
      }
      const success = await onSaveApiKey(value);
      if (success) {
        setIsEditingKey(false);
        setApiKeyInput('');
      }
    },
    [apiKeyInput, onSaveApiKey]
  );

  const handleDeleteApiKey = useCallback(async () => {
    const success = await onDeleteApiKey();
    if (success) {
      setIsEditingKey(false);
      setApiKeyInput('');
    }
  }, [onDeleteApiKey]);

  const handleModelChange = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      const model = event.target.value as LLMModel;
      setSelectedModel(model);
      await onModelChange(model);
    },
    [onModelChange]
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
          <div className="settings-section">
            <h3 className="settings-section-title">LLM API Key</h3>
            <div className="api-key-management">
              <div className="api-key-status">
                {apiKeyStatus?.hasKey ? (
                  <>
                    <span>
                      Saved key ({apiKeyStatus.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'}):{' '}
                      <span className="api-key-mask">{apiKeyStatus.maskedKey ?? '••••••••'}</span>
                    </span>
                    <p>Update or remove your API key. The key is stored locally and never leaves this device.</p>
                  </>
                ) : (
                  <p>No API key saved. Add one to enable AI features.</p>
                )}
              </div>
              {!isEditingKey && (
                <div className="api-key-actions">
                  <button type="button" onClick={() => setIsEditingKey(true)}>
                    {apiKeyStatus?.hasKey ? 'Edit key' : 'Add key'}
                  </button>
                  {apiKeyStatus?.hasKey && (
                    <button type="button" onClick={handleDeleteApiKey} disabled={isApiKeyBusy}>
                      {isApiKeyBusy ? 'Removing…' : 'Delete key'}
                    </button>
                  )}
                </div>
              )}
              {isEditingKey && (
                <form className="api-key-inline-form" onSubmit={handleSubmitApiKey}>
                  <input
                    type="password"
                    placeholder="sk-..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    disabled={isApiKeyBusy}
                  />
                  <div className="api-key-actions">
                    <button type="button" onClick={() => setIsEditingKey(false)} disabled={isApiKeyBusy}>
                      Cancel
                    </button>
                    <button type="submit" disabled={isApiKeyBusy || apiKeyInput.trim().length === 0}>
                      {isApiKeyBusy ? 'Saving…' : 'Save key'}
                    </button>
                  </div>
                </form>
              )}
              {apiKeyError && <p className="settings-error">{apiKeyError}</p>}
            </div>
          </div>
          <div className="settings-section">
            <h3 className="settings-section-title">LLM Model</h3>
            <div className="model-selection">
              <p className="settings-description">
                Choose which AI model to use for summarization and organization. Different models have different
                capabilities and costs.
              </p>
              <select
                className="model-select"
                value={selectedModel ?? ''}
                onChange={handleModelChange}
                disabled={isModelBusy || !apiKeyStatus?.hasKey}
              >
                {!selectedModel && <option value="">Select a model...</option>}
                {AVAILABLE_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.provider})
                  </option>
                ))}
              </select>
              {!apiKeyStatus?.hasKey && (
                <p className="settings-hint">Add an API key to enable model selection.</p>
              )}
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
