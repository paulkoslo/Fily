import { useEffect, useRef, useState } from 'react';

interface ApiKeyModalProps {
  isOpen: boolean;
  isSaving: boolean;
  error?: string | null;
  onSubmit: (apiKey: string, keyType: ApiKeyType) => void;
}

const PROVIDER_INFO: Record<ApiKeyType, { name: string; placeholder: string; link: string; linkText: string }> = {
  openrouter: {
    name: 'OpenRouter',
    placeholder: 'sk-or-...',
    link: 'https://openrouter.ai/keys',
    linkText: 'openrouter.ai/keys',
  },
  openai: {
    name: 'OpenAI',
    placeholder: 'sk-...',
    link: 'https://platform.openai.com/api-keys',
    linkText: 'platform.openai.com/api-keys',
  },
};

export function ApiKeyModal({ isOpen, isSaving, error, onSubmit }: ApiKeyModalProps) {
  const [value, setValue] = useState('');
  const [provider, setProvider] = useState<ApiKeyType>('openrouter');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setValue('');
      const timeout = setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    onSubmit(trimmed, provider);
  };

  const info = PROVIDER_INFO[provider];

  return (
    <div className="api-key-overlay">
      <div className="api-key-modal">
        <h2>Connect LLM Provider</h2>
        <p>
          Fily uses an LLM API to summarize, tag, and organize files locally. Your key stays on this device and is
          never uploaded.
        </p>
        <form onSubmit={handleSubmit} className="api-key-form">
          <label htmlFor="provider-select">Provider</label>
          <select
            id="provider-select"
            value={provider}
            onChange={(event) => setProvider(event.target.value as ApiKeyType)}
            disabled={isSaving}
            className="api-key-select"
          >
            <option value="openrouter">OpenRouter (recommended)</option>
            <option value="openai">OpenAI</option>
          </select>

          <label htmlFor="api-key-input">{info.name} API Key</label>
          <input
            id="api-key-input"
            ref={inputRef}
            type="password"
            placeholder={info.placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={isSaving}
            required
          />
          {error && <p className="api-key-error">{error}</p>}
          <button type="submit" disabled={isSaving || value.trim().length === 0}>
            {isSaving ? 'Saving…' : 'Save key'}
          </button>
        </form>
        <p className="api-key-footer">
          Need a key? Create one at{' '}
          <a href={info.link} target="_blank" rel="noreferrer">
            {info.linkText}
          </a>
          .
        </p>
        {provider === 'openrouter' && (
          <p className="api-key-hint">
            OpenRouter lets you use many LLM providers (OpenAI, Anthropic, Google, etc.) with a single API key.
          </p>
        )}
      </div>
    </div>
  );
}
