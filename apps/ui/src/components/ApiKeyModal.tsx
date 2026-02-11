import { useEffect, useRef, useState } from 'react';

interface ApiKeyModalProps {
  isOpen: boolean;
  isSaving: boolean;
  error?: string | null;
  onSubmit: (apiKey: string) => void;
}

export function ApiKeyModal({ isOpen, isSaving, error, onSubmit }: ApiKeyModalProps) {
  const [value, setValue] = useState('');
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
    onSubmit(trimmed);
  };

  return (
    <div className="api-key-overlay">
      <div className="api-key-modal">
        <h2>Connect OpenAI</h2>
        <p>
          Fily uses your personal OpenAI API key to summarize, tag, and organize files locally. Your key stays on
          this device and is never uploaded.
        </p>
        <form onSubmit={handleSubmit} className="api-key-form">
          <label htmlFor="api-key-input">OpenAI API Key</label>
          <input
            id="api-key-input"
            ref={inputRef}
            type="password"
            placeholder="sk-..."
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
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
            platform.openai.com/api-keys
          </a>
          .
        </p>
      </div>
    </div>
  );
}
