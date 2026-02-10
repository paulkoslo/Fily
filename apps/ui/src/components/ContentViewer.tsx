import { useEffect, useState } from 'react';

interface ContentViewerProps {
  fileId: string;
  fileName: string;
  filePath?: string;
  isOpen: boolean;
  onClose: () => void;
  /**
   * View variant:
   * - 'full': show full extracted text + metadata
   * - 'card': compact file card (summary + tags + basic info)
   */
  variant?: 'full' | 'card';
}

export function ContentViewer({
  fileId,
  fileName,
  filePath,
  isOpen,
  onClose,
  variant = 'full',
}: ContentViewerProps) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && fileId) {
      loadContent();
    } else {
      setContent(null);
      setError(null);
    }
  }, [isOpen, fileId]);

  const loadContent = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await window.api.getFileContent({ fileId });
      if (response.success) {
        setContent(response.content);
      } else {
        setError(response.error || 'Failed to load content');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const keywords = content?.keywords ? JSON.parse(content.keywords) : [];
  const tags = content?.tags ? JSON.parse(content.tags) : [];
  const metadata = content?.metadata ? JSON.parse(content.metadata) : {};

  const isCard = variant === 'card';

  return (
    <div className="content-viewer-overlay" onClick={onClose}>
      <div className="content-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="content-viewer-header">
          <h2>{isCard ? `File Card: ${fileName}` : `Extracted Content: ${fileName}`}</h2>
          <button className="content-viewer-close" onClick={onClose}>×</button>
        </div>

        <div className="content-viewer-body">
          {loading && <div className="content-viewer-loading">Loading content...</div>}
          
          {error && (
            <div className="content-viewer-error">
              <strong>Error:</strong> {error}
            </div>
          )}

          {content && (
            <>
              {content.error_message ? (
                <div className="content-viewer-error">
                  <strong>Extraction Error:</strong> {content.error_message}
                </div>
              ) : (
                <>
                  {filePath && (
                    <div className="content-viewer-section">
                      <h3>Location</h3>
                      <p className="content-viewer-text" style={{ maxHeight: 'unset' }}>
                        {filePath}
                      </p>
                    </div>
                  )}

                  <div className="content-viewer-section">
                    <h3>Content Type</h3>
                    <p>{content.content_type}</p>
                  </div>

                  {content.summary && (
                    <div className="content-viewer-section">
                      <h3>Summary</h3>
                      <p className="content-viewer-text">{content.summary}</p>
                    </div>
                  )}

                  {tags.length > 0 && (
                    <div className="content-viewer-section">
                      <h3>Tags</h3>
                      <div className="content-viewer-keywords">
                        {tags.map((tag: string, i: number) => (
                          <span key={i} className="content-viewer-keyword">{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {keywords.length > 0 && tags.length === 0 && (
                    <div className="content-viewer-section">
                      <h3>Keywords</h3>
                      <div className="content-viewer-keywords">
                        {keywords.map((keyword: string, i: number) => (
                          <span key={i} className="content-viewer-keyword">{keyword}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* For full view, show extracted text + metadata + extraction info.
                      For card view, keep it compact and skip the heavy sections. */}
                  {!isCard && content.extracted_text && (
                    <div className="content-viewer-section">
                      <h3>Extracted Text</h3>
                      <pre className="content-viewer-text">{content.extracted_text}</pre>
                    </div>
                  )}

                  {!isCard && Object.keys(metadata).length > 0 && (
                    <div className="content-viewer-section">
                      <h3>Metadata</h3>
                      <pre className="content-viewer-metadata">{JSON.stringify(metadata, null, 2)}</pre>
                    </div>
                  )}

                  {!isCard && (
                    <div className="content-viewer-section">
                      <h3>Extraction Info</h3>
                      <p>Extracted at: {new Date(content.extracted_at).toLocaleString()}</p>
                      <p>Extractor version: {content.extractor_version}</p>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {!content && !loading && !error && (
            <div className="content-viewer-empty">
              No content extracted yet. Click "Extract Content" to extract content from this file.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
