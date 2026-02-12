import type { FileCard } from '../ipc/contracts';

export type TaxonomyOverview = {
  sourceId: number;
  fileCount: number;
  byExtension: Record<string, number>;
  byYear: Record<string, number>;
  topTags: { tag: string; count: number }[];
  topPathPatterns: { pattern: string; count: number }[];
  samples: {
    tag: string;
    files: FileCard[];
  }[];
};

type BuildOverviewOptions = {
  maxTags?: number;
  samplesPerTag?: number;
};

export function buildTaxonomyOverview(
  sourceId: number,
  fileCards: FileCard[],
  options: BuildOverviewOptions = {}
): TaxonomyOverview {
  const maxTags = options.maxTags ?? 50; // Increased from 20 to support larger datasets
  const samplesPerTag = options.samplesPerTag ?? 20; // Increased from 3 to provide more context

  const byExtension: Record<string, number> = {};
  const byYear: Record<string, number> = {};
  const tagCounts = new Map<string, number>();
  const pathPatternCounts = new Map<string, number>();

  for (const card of fileCards) {
    // Extension statistics
    const extKey = card.extension.toLowerCase();
    if (extKey) {
      byExtension[extKey] = (byExtension[extKey] ?? 0) + 1;
    }

    // Year statistics (derived from mtime)
    if (card.mtime) {
      const year = new Date(card.mtime).getFullYear();
      if (!Number.isNaN(year) && year > 1970 && year < 2100) {
        const yearKey = String(year);
        byYear[yearKey] = (byYear[yearKey] ?? 0) + 1;
      }
    }

    // Tag frequencies
    for (const rawTag of card.tags ?? []) {
      const tag = rawTag.toLowerCase().trim();
      if (!tag) continue;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    // Path pattern statistics (based on relative path when available)
    const pathLike = (card.relative_path ?? card.path) || '';
    const normalized = pathLike.replace(/^[/\\]+/, '');
    const segments = normalized.split(/[/\\]+/).filter(Boolean);
    if (segments.length > 0) {
      const depth = Math.min(3, segments.length);
      const pattern = segments.slice(0, depth).join('/');
      if (pattern) {
        pathPatternCounts.set(pattern, (pathPatternCounts.get(pattern) ?? 0) + 1);
      }
    }
  }

  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, maxTags)
    .map(([tag, count]) => ({ tag, count }));

  const topPathPatterns = Array.from(pathPatternCounts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    // Keep the most common patterns to avoid bloating the prompt
    .slice(0, 50)
    .map(([pattern, count]) => ({ pattern, count }));

  // Build samples per top tag
  const samples: TaxonomyOverview['samples'] = [];
  const cardsByTag = new Map<string, FileCard[]>();

  for (const card of fileCards) {
    for (const rawTag of card.tags ?? []) {
      const tag = rawTag.toLowerCase().trim();
      if (!tag) continue;
      if (!cardsByTag.has(tag)) {
        cardsByTag.set(tag, []);
      }
      const list = cardsByTag.get(tag)!;
      if (list.length < samplesPerTag) {
        list.push(card);
      }
    }
  }

  for (const { tag } of topTags) {
    const list = cardsByTag.get(tag) ?? [];
    if (list.length === 0) continue;
    samples.push({
      tag,
      files: list.slice(0, samplesPerTag),
    });
  }

  return {
    sourceId,
    fileCount: fileCards.length,
    byExtension,
    byYear,
    topTags,
    topPathPatterns,
    samples,
  };
}

