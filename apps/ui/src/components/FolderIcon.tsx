import { memo } from 'react';

interface FolderIconProps {
  className?: string;
}

export const FolderIcon = memo(function FolderIcon({ className = '' }: FolderIconProps) {
  return (
    <span className={`file-icon-img folder-icon ${className}`} aria-hidden>
      <img src="./icons/folder-dark.png" alt="" className="icon-dark" />
      <img src="./icons/Folder-light.png" alt="" className="icon-light" />
    </span>
  );
});
