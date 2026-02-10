import { useEffect, useRef, useCallback } from 'react';

interface UseInfiniteScrollOptions {
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  threshold?: number; // Distance from bottom to trigger load (default 200px)
}

/**
 * Hook for infinite scroll functionality.
 * Triggers onLoadMore when user scrolls near the bottom of the container.
 */
export function useInfiniteScroll({
  hasMore,
  isLoading,
  onLoadMore,
  threshold = 200,
}: UseInfiniteScrollOptions): (element: HTMLElement | null) => void {
  const containerRef = useRef<HTMLElement | null>(null);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container || isLoading || !hasMore) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    if (distanceFromBottom < threshold) {
      onLoadMore();
    }
  }, [hasMore, isLoading, onLoadMore, threshold]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  return (element: HTMLElement | null) => {
    containerRef.current = element;
  };
}
