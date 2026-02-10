import { memo, useCallback, type ChangeEvent } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const SearchInput = memo(function SearchInput({
  value,
  onChange,
  disabled,
}: SearchInputProps) {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  return (
    <div className="search-container">
      <span className="search-icon">S</span>
      <input
        type="text"
        className="search-input"
        placeholder="Search files..."
        value={value}
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  );
});
