# AGENTS.md - Fily Architecture Vision

> **This document describes the VISION and ARCHITECTURE for AI integration.**  
> For the current implementation status, see [README.md](./README.md).

## Overview

Fily is a local-first macOS desktop app that creates a **virtual, AI-organized file browser**. It indexes files without moving/renaming/deleting them, presenting an intelligent virtual folder structure while preserving original file locations.

**Current Implementation**: Uses a unified `LLMClient` abstraction that supports multiple LLM providers:
- **OpenRouter** (recommended) - Access to multiple models (GPT-5, Grok, DeepSeek, etc.)
- **OpenAI** - Direct OpenAI API access (fallback option)

AI agents (SummaryAgent, TagAgent, TaxonomyAgent) use this abstraction to extract content, generate summaries/tags, and design intelligent virtual folder hierarchies.

**Future Goal**: Integrate [llama-fs](https://github.com/iyaja/llama-fs) or similar local LLM solutions for privacy-focused, offline AI organization.

## Agentic Architecture Vision

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Fily Pipeline                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────┐    ┌──────────┐    ┌─────────┐    ┌──────────────┐   │
│   │  INDEX  │───▶│ RETRIEVE │───▶│  PLAN   │───▶│ BUILD VIRTUAL│   │
│   │         │    │          │    │         │    │     TREE     │   │
│   └─────────┘    └──────────┘    └─────────┘    └──────────────┘   │
│        │              │               │                │            │
│        ▼              ▼               ▼                ▼            │
│   ┌─────────┐    ┌──────────┐    ┌─────────┐    ┌──────────────┐   │
│   │ SQLite  │    │  File    │    │ Planner │    │   Virtual    │   │
│   │   DB    │    │ Records  │    │ Output  │    │   Tree UI    │   │
│   └─────────┘    └──────────┘    └─────────┘    └──────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Pipeline Stages

1. **INDEX**: Crawl source directories, extract file metadata, compute stable file_id, store in SQLite ✅
2. **EXTRACT**: Extract content from files (PDF, DOCX, images, audio, etc.) and generate summaries/tags ✅
3. **RETRIEVE**: Query indexed files by source, filter by search terms, prepare for planning ✅
4. **PLAN**: Generate virtual placement decisions (virtual_path, tags, confidence, reason) ✅
   - **StubPlanner**: Rule-based, extension-based categorization ✅
   - **TaxonomyPlanner**: AI-powered taxonomy generation using OpenAI ✅
5. **BUILD VIRTUAL TREE**: Construct hierarchical tree structure from planner output ✅
6. **UI**: Render virtual tree, handle user interactions, open original files ✅

## Current AI Implementation

### LLMClient Abstraction

The application uses a unified `LLMClient` (`packages/core/src/agents/llm-client.ts`) that abstracts LLM provider differences:

```typescript
export type LLMProvider = 'openrouter' | 'openai';

export class LLMClient {
  // Wraps OpenAI SDK, configures baseURL for OpenRouter
  // Handles model mapping between providers
  async chatCompletion(messages, options): Promise<string>;
}
```

**Provider Priority**: OpenRouter > OpenAI (if both keys are configured)

**Supported Models** (OpenRouter):
- `openai/gpt-5-nano` - Fast & cheap (default)
- `openai/gpt-5-mini` - Balanced performance
- `x-ai/grok-4.1-fast` - xAI's fast model
- `deepseek/deepseek-v3.2` - DeepSeek's latest

### Implemented Agents

The application uses provider-agnostic agents for content understanding:

1. **SummaryAgent** (`packages/core/src/agents/summary-agent.ts`)
   - Generates intelligent summaries from extracted file content
   - Handles different file types (PDF, DOCX, images, audio, etc.)
   - Uses LLMClient for provider-agnostic API calls

2. **TagAgent** (`packages/core/src/agents/tag-agent.ts`)
   - Generates relevant tags for files based on content and metadata
   - Produces structured tag arrays for better searchability
   - Uses LLMClient for provider-agnostic API calls

3. **TaxonomyAgent** (`packages/core/src/agents/taxonomy-agent.ts`)
   - Designs virtual folder taxonomies based on file collections
   - Generates mapping rules for file placement
   - Uses LLMClient for provider-agnostic API calls

### Implemented Planners

1. **StubPlanner** (`packages/core/src/planner/stub-planner.ts`)
   - Rule-based, extension-based categorization
   - Fast, deterministic placement
   - Useful for testing and fallback scenarios

2. **TaxonomyPlanner** (`packages/core/src/planner/taxonomy-planner.ts`) ✅ **ACTIVE**
   - AI-powered virtual folder organization
   - Uses TaxonomyAgent to design folder hierarchies
   - Applies deterministic rules based on AI-generated taxonomy
   - Currently the default planner used in production

### Content Extraction Pipeline

The extraction pipeline (`packages/core/src/extractors/`) supports:
- **PDF**: Text extraction, metadata parsing
- **DOCX/DOC**: Document text extraction
- **XLSX/XLS**: Spreadsheet content extraction
- **PPTX/PPT**: Presentation text extraction
- **Images**: Metadata extraction (EXIF, etc.)
- **Audio**: Metadata extraction (ID3 tags, etc.)
- **Text files**: Direct text reading

All extracted content is stored in SQLite and used by agents for summarization and tagging.

## Future: llama-fs Integration Plan

The `Planner` interface is designed for easy swap-in of llama-fs or other local LLM solutions:

```typescript
// packages/core/src/planner/index.ts
export interface Planner {
  plan(files: FileRecord[]): Promise<PlannerOutput[]>;
}

// Current: TaxonomyPlanner (OpenAI-based, AI-powered)
// Future: LlamaFSPlanner (local LLM, privacy-focused, async, out-of-process)
```

### Integration Steps for llama-fs

1. Create `packages/core/src/planner/llama-fs-planner.ts`
2. Implement the `Planner` interface
3. Use child_process or worker_threads for out-of-process execution
4. Parse llama-fs JSON output into `PlannerOutput` schema
5. Update `apps/desktop/src/main/ipc-handlers.ts` to use new planner
6. Add progress reporting via IPC for long-running plans

### Background Worker Structure (for Future Implementation)

```typescript
// Future: packages/core/src/planner/llama-fs-planner.ts
import { Worker } from 'worker_threads';

export class LlamaFSPlanner implements Planner {
  private worker: Worker | null = null;

  async plan(files: FileRecord[]): Promise<PlannerOutput[]> {
    // Spawn worker, send files, receive structured JSON
    // Worker runs llama-fs CLI or Python bridge
  }

  async cancel(): Promise<void> {
    // Terminate worker gracefully
  }
}
```

## Current Implementation Details

### FileCard Concept

The planner system uses a `FileCard` abstraction that combines file metadata with AI-generated content:

```typescript
// packages/core/src/ipc/contracts.ts
export type FileCard = {
  file_id: string;
  source_id: number;
  path: string;
  relative_path: string | null;
  name: string;
  extension: string;
  size: number;
  mtime: number;
  summary: string | null;  // From SummaryAgent
  tags: string[];          // From TagAgent
};
```

FileCards are built by joining `files` and `file_content` tables, providing a unified view for planners and agents.

### UI Features

**Filesystem View:**
- Browse files and folders in their original structure
- Search across all indexed files
- Right-click files to view extracted content
- Click info icon (ℹ️) to view file card (summary + tags)
- Double-click to open files in default app

**Virtual Tree View:**
- Browse AI-organized virtual folder structure
- Expand/collapse folders
- Navigate into folders
- Same file interaction features as filesystem view
- Shows confidence scores for AI placements

**Pipeline Actions:**
- **"Organize" button**: Full pipeline (Scan → Extract → AI Organize) in one click
- **"Manual" dropdown**: Individual actions (Scan only, Extract only, Organize only)
- Progress indicators for all operations
- Warning dialog when re-organizing existing virtual trees
- **API key prompt**: Automatically prompts to add API key when using AI features without one configured

**Settings:**
- **LLM Provider Selection**: Choose between OpenRouter and OpenAI
- **Model Selection**: Select from available models (OpenRouter only)
- **API Key Management**: Add, view, and delete API keys in-app

### Database Schema

Key tables:
- `files`: File records with metadata
- `file_content`: Extracted content, summaries, tags
- `virtual_placements`: Planner outputs (virtual_path, tags, confidence, reason)
- `sources`: Indexed source directories

## JSON Contract for Planner Output

All planners must produce output conforming to this schema:

```typescript
// Validated with zod in packages/core/src/ipc/contracts.ts

interface PlannerOutput {
  file_id: string;           // Stable ID: sha1(path + size + mtime)
  virtual_path: string;      // e.g., "/Projects/Web/my-app/README.md"
  tags: string[];            // e.g., ["documentation", "readme", "web"]
  confidence: number;        // 0.0 - 1.0, how confident is the placement
  reason: string;            // Human-readable explanation
}
```

### Example Planner Output

```json
{
  "file_id": "a1b2c3d4e5f6...",
  "virtual_path": "/Work/Reports/Q4-2024/sales-report.xlsx",
  "tags": ["work", "reports", "excel", "q4-2024"],
  "confidence": 0.85,
  "reason": "Excel file with 'sales' and 'Q4' in filename, placed in quarterly reports"
}
```

## Coding Conventions

### Adding New Modules

1. **Create module folder** in appropriate package:
   - Shared logic → `packages/core/src/`
   - Electron main → `apps/desktop/src/main/`
   - React UI → `apps/ui/src/`

2. **Export from index.ts**:
   ```typescript
   // packages/core/src/your-module/index.ts
   export * from './implementation';
   export type * from './types';
   ```

3. **Use zod for all external data**:
   ```typescript
   import { z } from 'zod';
   
   export const YourSchema = z.object({
     field: z.string(),
   });
   
   export type YourType = z.infer<typeof YourSchema>;
   ```

4. **IPC additions**:
   - Add schema to `packages/core/src/ipc/contracts.ts`
   - Add handler to `apps/desktop/src/main/ipc-handlers.ts`
   - Expose in `apps/desktop/src/preload/index.ts`
   - Add type to `apps/ui/src/types.d.ts`

### File Naming

- Use kebab-case for files: `stub-planner.ts`
- Use PascalCase for React components: `FileList.tsx`
- Use camelCase for functions and variables
- Suffix interfaces with descriptive names, not `I` prefix

### Error Handling

```typescript
// Always return structured errors, never throw in IPC handlers
type Result<T> = { success: true; data: T } | { success: false; error: string };
```

## Safety Checklist for Future Features

### Before Implementing Any Feature

- [ ] **No destructive operations by default** - Never delete, move, or rename actual files without explicit user action
- [ ] **Audit log** - Log all operations that could affect files (planned for Phase 5)
- [ ] **Undo support** - Design with undo in mind (virtual operations are inherently reversible)
- [ ] **Confirmation dialogs** - Require confirmation for any operation that affects real filesystem
- [ ] **Dry-run mode** - Allow previewing changes before applying
- [ ] **Rate limiting** - Limit API calls and filesystem operations
- [ ] **Sandboxed paths** - Never access paths outside user-specified sources

### Database Safety

- [ ] **Migrations only** - Never modify schema directly, use migrations
- [ ] **Backup before schema changes** - Automatic DB backup on version upgrade
- [ ] **Foreign keys** - Use SQLite foreign keys for referential integrity
- [ ] **Transactions** - Wrap related operations in transactions

### IPC Safety

- [ ] **Validate all inputs** - Use zod schemas for all IPC messages
- [ ] **Sanitize paths** - Prevent path traversal attacks
- [ ] **No shell injection** - Never interpolate user input into shell commands

## Module Responsibilities

### packages/core

| Module | Responsibility |
|--------|---------------|
| `db/` | SQLite connection, migrations, CRUD operations |
| `indexer/` | Crawl directories, compute file_id, manage file records |
| `extractors/` | Content extraction from various file types (PDF, DOCX, images, audio, etc.) |
| `agents/` | AI agents (SummaryAgent, TagAgent, TaxonomyAgent) using LLMClient |
| `agents/llm-client.ts` | Unified LLM abstraction (OpenRouter, OpenAI) with model selection |
| `agents/prompts/` | Prompt templates for AI agents |
| `planner/` | Interface + implementations for virtual placement decisions |
| `planner/taxonomy-*` | Taxonomy-driven planner implementation (TaxonomyPlanner, TaxonomyAgent, TaxonomyOverview) |
| `virtual-tree/` | Build hierarchical tree from flat planner outputs |
| `ipc/` | Zod schemas and types for all IPC contracts |

### apps/desktop

| Module | Responsibility |
|--------|---------------|
| `main/` | Electron main process, window management, IPC handlers |
| `preload/` | Secure bridge between main and renderer |

### apps/ui

| Module | Responsibility |
|--------|---------------|
| `components/` | React components for UI (FileBrowser, VirtualTreeView, ContentViewer, etc.) |
| `hooks/` | Custom React hooks for state and IPC |
| `styles/` | CSS and styling |
| `themes/` | Theme system for UI customization |

## Phase Roadmap

| Phase | Features | Status |
|-------|----------|--------|
| 0 | Basic app, crawler, SQLite, flat file list | ✅ **Complete** |
| 1 | Watch mode (filesystem events), incremental updates | ✅ **Complete** |
| 2 | Virtual folder tree UI (hierarchical view) | ✅ **Complete** |
| 3 | Content extraction pipeline (text preview, summaries, tags) | ✅ **Complete** |
| 4 | **AI planner integration (TaxonomyPlanner)** | ✅ **Complete** |
| 5 | Feedback loop, user rules, quality improvements | 📋 Planned |
| 6 | **Local LLM integration (llama-fs)** | 📋 Future |

### Phase 4 Details (AI Integration) ✅ **IMPLEMENTED**

The `TaxonomyPlanner` is now the default planner, using `LLMClient` for provider-agnostic LLM calls:

```typescript
// packages/core/src/planner/taxonomy-planner.ts
class TaxonomyPlanner implements Planner {
  async plan(files: FileRecord[]): Promise<PlannerOutput[]> {
    // 1. Build FileCard[] from DB (includes summaries and tags from SummaryAgent/TagAgent)
    // 2. Build TaxonomyOverview (aggregate stats: extensions, years, tags, path patterns)
    // 3. Call TaxonomyAgent.generatePlan() to get TaxonomyPlan (folders + rules)
    // 4. Apply rules deterministically to produce PlannerOutput[]
    // 5. Store in virtual_placements table
  }
}
```

**Key Components:**
- `LLMClient`: Unified abstraction for OpenRouter and OpenAI APIs
- `TaxonomyAgent`: LLM agent that designs virtual folder hierarchies
- `TaxonomyOverview`: Aggregated file statistics for taxonomy design
- `TaxonomyPlan`: Structure defining folders and placement rules
- `TaxonomyPlanner`: Orchestrates the planning process

**Provider Selection:**
- Users can select OpenRouter or OpenAI in Settings
- OpenRouter supports multiple models (GPT-5, Grok, DeepSeek)
- Model selection persisted in user's .env file

### Phase 6 Details (Future: Local LLM Integration)

The `Planner` interface is designed to allow swapping to local LLM solutions:

```typescript
// Future: LlamaFSPlanner uses local LLM to understand content
// packages/core/src/planner/llama-fs-planner.ts (to be created)

class LlamaFSPlanner implements Planner {
  async plan(files: FileRecord[]): Promise<PlannerOutput[]> {
    // 1. Extract text/metadata from files
    // 2. Send to llama-fs for categorization
    // 3. Parse JSON response into PlannerOutput[]
    // 4. Store decisions with confidence scores
  }
}
```

## Quick Reference

### Key Files for AI Integration

| File | Purpose |
|------|---------|
| `packages/core/src/agents/llm-client.ts` | ✅ **LLMClient** - Unified LLM abstraction (OpenRouter, OpenAI) |
| `packages/core/src/agents/summary-agent.ts` | Content summarization agent |
| `packages/core/src/agents/tag-agent.ts` | Intelligent tagging agent |
| `packages/core/src/agents/taxonomy-agent.ts` | Taxonomy design agent |
| `packages/core/src/agents/api-call-helper.ts` | Helper for executing LLM API calls with fallback |
| `packages/core/src/agents/prompts/` | Prompt templates for all agents |
| `packages/core/src/planner/index.ts` | Planner interface definition |
| `packages/core/src/planner/stub-planner.ts` | Rule-based reference implementation |
| `packages/core/src/planner/taxonomy-planner.ts` | ✅ **Active AI planner** |
| `packages/core/src/planner/taxonomy-agent.ts` | LLM agent for taxonomy generation |
| `packages/core/src/planner/taxonomy-overview.ts` | File statistics aggregation |
| `packages/core/src/planner/taxonomy-types.ts` | Type definitions for taxonomy plans |
| `packages/core/src/extractors/` | Content extraction from various file types |
| `packages/core/src/ipc/contracts.ts` | `PlannerOutput`, `FileCard`, API key schemas |
| `packages/core/src/db/migrations.ts` | `virtual_placements` table |
| `packages/core/src/virtual-tree/index.ts` | Builds tree from planner output |
| `apps/desktop/src/main/api-key-store.ts` | API key and model persistence |
| `apps/desktop/src/main/ipc-handlers.ts` | IPC handlers for all operations |
| `apps/ui/src/App.tsx` | UI integration for planner execution |
| `apps/ui/src/components/Settings.tsx` | Settings UI (API key, model selection) |

### Dev Commands

```bash
# Start the application (builds and runs)
npm run dev

# Build all packages
npm run build

# Rebuild native modules for Electron
npm run rebuild

# Package for distribution
cd apps/desktop && npm run package
```

See [README.md](./README.md) for full installation instructions.

## Current Status Summary

✅ **Implemented:**
- Full content extraction pipeline (PDF, DOCX, images, audio, etc.)
- AI-powered summarization and tagging
- Taxonomy-driven virtual organization (TaxonomyPlanner)
- Virtual tree UI with expand/collapse and navigation
- Watch mode for automatic file indexing
- Search across files, content, and tags
- File card view and full content viewer
- Progress tracking for all operations
- Warning dialogs for destructive operations
- **Multi-provider LLM support** (OpenRouter + OpenAI)
- **In-app API key configuration** with provider selection
- **Model selection** (GPT-5 Nano/Mini, Grok 4.1 Fast, DeepSeek V3.2)
- **API key prompt** when using AI features without a key configured

📋 **Planned:**
- User feedback loop for improving AI organization
- Custom rules and overrides
- Quality metrics and confidence thresholds
- Batch operations and bulk actions

🔮 **Future:**
- Local LLM integration (llama-fs) for privacy-focused organization
- Advanced search with semantic understanding
- Thumbnail generation for images
- Multi-source virtual folder merging
- Export/import of virtual organizations
