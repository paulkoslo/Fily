import { useState, useEffect, useCallback, useRef, memo } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onResultSelect?: (result: SmartSearchResult) => void;
  disabled?: boolean;
  sourceId?: number | null;
}

// Use global SmartSearchResult type from types.d.ts
type SmartSearchResult = {
  file_id: string;
  name: string;
  path: string;
  relative_path: string | null;
  parent_path: string | null;
  extension: string;
  size: number;
  mtime: number;
  source_id: number;
  match_type: 'filename' | 'summary' | 'tags';
  match_score: number;
  summary: string | null;
  tags?: string[];
  virtual_path: string | null;
};

export const SearchBar = memo(function SearchBar({
  value,
  onChange,
  onResultSelect,
  disabled,
  sourceId,
}: SearchBarProps) {
  const [results, setResults] = useState<SmartSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Perform search with debouncing
  const performSearch = useCallback(
    async (query: string) => {
      if (!query.trim() || query.length < 2) {
        setResults([]);
        setIsOpen(false);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        const response = await window.api.smartSearchFiles({
          query: query.trim(),
          sourceId: sourceId || undefined,
          limit: 20,
        });

        if (response.success) {
          setResults(response.results);
          setIsOpen(response.results.length > 0);
          setSelectedIndex(-1);
        } else {
          setResults([]);
          setIsOpen(false);
        }
      } catch (err) {
        console.error('Search error:', err);
        setResults([]);
        setIsOpen(false);
      } finally {
        setIsSearching(false);
      }
    },
    [sourceId]
  );

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (value.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(value);
      }, 300); // 300ms debounce
    } else {
      setResults([]);
      setIsOpen(false);
      setIsSearching(false);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [value, performSearch]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen || results.length === 0) {
        if (e.key === 'Escape') {
          setIsOpen(false);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < results.length) {
            const result = results[selectedIndex];
            if (onResultSelect) {
              onResultSelect(result);
            }
            setIsOpen(false);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setSelectedIndex(-1);
          break;
      }
    },
    [isOpen, results, selectedIndex, onResultSelect]
  );

  const handleResultClick = useCallback(
    (result: SmartSearchResult) => {
      if (onResultSelect) {
        onResultSelect(result);
      }
      setIsOpen(false);
    },
    [onResultSelect]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
      setSelectedIndex(-1);
    },
    [onChange]
  );

  const getMatchTypeLabel = (matchType: string) => {
    switch (matchType) {
      case 'filename':
        return '📄 Name';
      case 'summary':
        return '📝 Summary';
      case 'tags':
        return '🏷️ Tags';
      default:
        return '';
    }
  };

  return (
    <div className="search-bar-container" ref={containerRef}>
      <div className="search-container">
        <span className="search-icon">🔍</span>
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search files..."
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) {
              setIsOpen(true);
            }
          }}
          disabled={disabled}
        />
        {isSearching && <span className="search-loading">⏳</span>}
      </div>
      {isOpen && results.length > 0 && (
        <div className="search-results-dropdown">
          {results.map((result, index) => (
            <div
              key={result.file_id}
              className={`search-result-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleResultClick(result)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="search-result-header">
                <span className="search-result-name">{result.name}</span>
                <span className="search-result-match-type">{getMatchTypeLabel(result.match_type)}</span>
              </div>
              {result.relative_path && (
                <div className="search-result-path">{result.relative_path}</div>
              )}
              {result.summary && result.match_type === 'summary' && (
                <div className="search-result-summary">
                  {result.summary.length > 100
                    ? `${result.summary.substring(0, 100)}...`
                    : result.summary}
                </div>
              )}
              {result.tags && result.tags.length > 0 && result.match_type === 'tags' && (
                <div className="search-result-tags">
                  {result.tags.slice(0, 3).map((tag: string, i: number) => (
                    <span key={i} className="search-result-tag">
                      {tag}
                    </span>
                  ))}
                  {result.tags.length > 3 && <span className="search-result-tag-more">+{result.tags.length - 3}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
