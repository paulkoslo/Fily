import { memo } from 'react';

type IconType = 'pdf' | 'document' | 'image' | 'spreadsheet' | 'music' | 'code' | 'zip' | 'other';

function getIconType(extension: string): IconType {
  const ext = extension.toLowerCase();
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'ppt', 'pptx', 'key'].includes(ext)) return 'document';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'heic'].includes(ext)) return 'image';
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return 'spreadsheet';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return 'music';
  if (['zip', 'tar', 'gz', 'rar', '7z', 'dmg', 'iso'].includes(ext)) return 'zip';
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'scss', 'sh', 'bash', 'zsh'].includes(ext)) return 'code';
  return 'other';
}

const ICON_PATHS: Record<IconType, { dark: string; light: string }> = {
  pdf: { dark: './icons/pdf-file-dark.png', light: './icons/pdf-light.png' },
  document: { dark: './icons/document-file-dark.png', light: './icons/document-light.png' },
  image: { dark: './icons/image-file-dark.png', light: './icons/picture-light.png' },
  spreadsheet: { dark: './icons/spreadsheet-file-dark.png', light: './icons/spreadsheet-file-light.png' },
  music: { dark: './icons/music-file-dark.png', light: './icons/Music-file-light.png' },
  code: { dark: './icons/code-file-dark.png', light: './icons/code-file-light.png' },
  zip: { dark: './icons/zip-file-dark.png', light: './icons/zip-file-light.png' },
  other: { dark: './icons/other-file-dark.png', light: './icons/other-file-light.png' },
};

interface FileIconProps {
  extension: string;
  className?: string;
}

export const FileIcon = memo(function FileIcon({ extension, className = '' }: FileIconProps) {
  const type = getIconType(extension);
  const paths = ICON_PATHS[type];
  return (
    <span className={`file-icon-img ${className}`} aria-hidden>
      <img src={paths.dark} alt="" className="icon-dark" />
      <img src={paths.light} alt="" className="icon-light" />
    </span>
  );
});
