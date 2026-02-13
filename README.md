# fily, AI powered file management v1.1.1

A local-first macOS desktop application that creates an intelligent, AI-organized virtual file browser. Fily indexes your files and presents them in a smart virtual folder structure without moving, renaming, or deleting your original files. **Now capable of processing thousands of files efficiently** with optimized worker pools, parallel processing, and cost-effective AI integration.

## Overview

Fily solves the problem of disorganized files scattered across your system. Instead of manually organizing thousands of files, Fily uses AI to understand your content and automatically creates a virtual organization system. **With v1.1.1, Fily can efficiently process thousands of files** using optimized worker pools, parallel batch processing, and modular agent architecture. Your files stay exactly where they are—Fily simply provides a smarter way to find and browse them.

### Key Features

- **Large-Scale Processing**: Optimized for processing **thousands of files** efficiently with 80 concurrent workers and parallel batch processing
- **Virtual Organization**: AI-powered virtual folder structure that organizes files by content, context, and meaning
- **Non-Destructive**: Files are never moved, renamed, or deleted—your originals remain untouched
- **Multiple Source Folders**: Index and organize files from multiple directories simultaneously
- **Intelligent Content Extraction**: Automatically extracts and analyzes content from PDFs, documents, images, audio files, and more
- **AI-Powered Tagging**: Generates intelligent tags and summaries for better searchability
- **Real-Time Indexing**: Watch mode automatically detects and indexes new files as they appear
- **Fast Search**: Search across all indexed files by name, content, tags, or metadata
- **Native Integration**: Opens files with your default macOS applications
- **Local-First**: All data stored locally in SQLite—your files and metadata never leave your machine
- **Cost-Efficient**: Process thousands of files for just a few dollars in API costs

## Installation

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- macOS (other platforms not tested)
- LLM API key (one of the following):
  - **OpenRouter API key** (recommended) - Access multiple models: https://openrouter.ai/keys
  - **OpenAI API key** - Direct OpenAI access: https://platform.openai.com/api-keys

### Quick Start

```bash
# Clone the repository
git clone https://github.com/paulkoslo/Fily.git
cd Fily

# Install dependencies
npm install

# Install desktop app dependencies
cd apps/desktop && npm install && cd ../..

# Rebuild native modules for Electron (required!)
npm run rebuild

# Start the application (builds automatically)
npm run dev
```

**Note**: You can configure your API key directly in the app's Settings tab. The app will prompt you to add an API key when you try to use AI features.

### Running the Application

Start the application:

```bash
npm run dev
```

The application will launch and you can begin indexing and organizing your files. Configure your API key in Settings before using AI features.

### Packaging for Distribution

To create a distributable macOS application:

```bash
cd apps/desktop && npm run package
```

This creates a `.app` bundle in `apps/desktop/out/`.

## Configuration

### LLM API Configuration

Fily supports multiple LLM providers. You can configure your API key in two ways:

#### Option 1: In-App Configuration (Recommended)

1. Open the app and go to **Settings** (gear icon)
2. Click **"Add API Key"**
3. Select your provider (OpenRouter or OpenAI)
4. Enter your API key
5. Select your preferred model

The app will prompt you to add an API key when you try to use AI features without one configured.

#### Option 2: Environment Variables

Create a `.env` file in the project root:

```bash
# OpenRouter API Key (recommended - access to multiple models)
# Get your API key from: https://openrouter.ai/keys
OPENROUTER_API_KEY=your-openrouter-key-here

# OpenAI API Key (alternative)
# Get your API key from: https://platform.openai.com/api-keys
OPENAI_API_KEY=your-openai-key-here

# LLM Model (optional - defaults to openai/gpt-5-nano for OpenRouter)
LLM_MODEL=openai/gpt-5-nano
```

**Priority**: If both keys are configured, OpenRouter takes priority.

### Supported Models

When using OpenRouter, you can select from:

| Model ID | Description |
|----------|-------------|
| `openai/gpt-5-nano` | Fast & cheap (default) |
| `openai/gpt-5-mini` | Balanced performance |
| `x-ai/grok-4.1-fast` | xAI's fast model |
| `deepseek/deepseek-v3.2` | DeepSeek's latest model |

Model selection is available in the Settings tab when using OpenRouter.

## How It Works

Fily operates in four main stages:

1. **Index**: Crawls your source directories, extracts file metadata, and stores everything in a local SQLite database
2. **Extract Raw Content**: Extracts raw content from files using specialized extractors for PDFs, documents, images, audio, and more
3. **AI Processing**: Uses AI agents to generate summaries and tags in concurrent batches (utilizing 80 workers for parallel processing)
4. **Organize**: Creates virtual folder placements using taxonomy generation and optimization
5. **Browse**: Presents files in an intelligent virtual folder tree while preserving your original file structure

### Architecture

Fily is built with a modular architecture:

- **Electron Main Process**: Handles file system operations, database management, and IPC communication
- **React Renderer**: Modern UI built with React and TypeScript
- **Core Package**: Shared business logic including database, indexer, extractors, and AI agents
- **Type-Safe IPC**: All communication between processes validated with Zod schemas

## Project Structure

```
Fily/
├── apps/
│   ├── desktop/          # Electron main process + preload
│   │   ├── src/
│   │   │   ├── main/     # Main process (window, IPC handlers)
│   │   │   └── preload/  # Secure bridge to renderer
│   │   └── package.json  # Separate from workspace (has electron)
│   │
│   └── ui/               # React + Vite renderer
│       └── src/
│           ├── components/
│           ├── hooks/
│           └── themes/
│
├── packages/
│   └── core/             # Shared business logic
│       └── src/
│           ├── db/       # SQLite database (better-sqlite3)
│           ├── indexer/  # File crawler and watcher
│           ├── extractors/  # Content extraction pipeline
│           ├── agents/   # AI agents (modular folder structure)
│           │   ├── summary-tag-agent/  # Summary + tag generation
│           │   ├── taxonomy-agent/     # Taxonomy design
│           │   ├── validation-agent/  # Plan validation
│           │   ├── optimizer-agent/    # Placement optimization
│           │   ├── worker-pool.ts      # Concurrent processing
│           │   └── llm-client.ts       # LLM abstraction
│           ├── planner/  # Virtual path planner
│           ├── virtual-tree/  # Tree builder
│           └── ipc/      # Typed IPC contracts (Zod)
│
├── AGENTS.md             # Architecture vision for AI integration
├── README.md             # This file
└── package.json          # Workspace root
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop Framework | Electron 27 |
| UI Framework | React 18 |
| Build Tool (UI) | Vite 5 |
| Language | TypeScript 5 |
| Database | better-sqlite3 (SQLite) |
| Schema Validation | Zod |
| Packaging | electron-builder |
| AI Integration | OpenRouter API, OpenAI API |

## Features in Detail

### Content Extraction

Fily can extract and analyze content from:

- **PDFs**: Text extraction, metadata (title, author, pages), image-based PDF support
- **Documents**: DOCX, XLSX, PPTX with full text and metadata extraction
- **Images**: Caption generation, visual content analysis
- **Audio**: Transcription and content analysis
- **Text Files**: Plain text, markdown, code files

### AI Agents

The application uses specialized AI agents organized in modular folder structures:

- **SummaryTagAgent** (`agents/summary-tag-agent/`): Combined agent that generates both summaries and tags in a single API call
  - Processes files in parallel batches via WorkerPool (vision: 5 per batch, text: 20 per batch)
  - Modular structure: batch-processor, file-processor, parsers, helpers, tag-enricher, fallback
- **TaxonomyAgent** (`agents/taxonomy-agent/`): Designs virtual folder structures and placement rules
  - Supports single-pass and hierarchical multi-level taxonomy generation
  - Modular structure: parsers, trivial-plan fallback
- **ValidationAgent** (`agents/validation-agent/`): Validates taxonomy plans and fixes logical errors
  - Detects generic folder names, broken references, structural issues
- **OptimizerAgent** (`agents/optimizer-agent/`): Re-evaluates low-confidence placements and creates new folders when needed
  - Processes files in batches (25 per batch) via WorkerPool
  - Can create new folders when files don't fit existing structure

### Virtual Folder Tree

Files are organized into a virtual hierarchy that makes sense based on their content. You can browse by:

- Project or topic
- File type and purpose
- Date and context
- Custom taxonomy generated by AI

## Security & Privacy

- **Local-First**: All data stored locally in SQLite database
- **No Cloud Sync**: Your files and metadata never leave your machine
- **Secure IPC**: All inter-process communication validated with Zod schemas
- **Sandboxed Renderer**: UI has no direct file system access
- **Non-Destructive**: Files are never modified, moved, or deleted

## Performance

- **Concurrent Batch Processing**: Worker pool with 80 concurrent workers (configurable via constants.ts) processes batches efficiently
- **Optimized Batch Submission**: All batches submitted immediately, processed as workers become available
- **Efficient Batching**: Vision files (5 per batch), text files (20 per batch), optimizer (25 per batch) for optimal API usage
- **Parallel Processing**: Subfolder generation, optimizer batches, and validation all use WorkerPool for parallel execution
- **Modular Architecture**: All agents organized in clean folder structures with clear separation of concerns
- **Centralized Configuration**: All thresholds, batch sizes, and timeouts in `constants.ts` for easy adjustment
- **Lazy Image Loading**: Images loaded only when needed, minimizing memory usage
- **Batch Operations**: Database inserts and updates batched for efficiency
- **Incremental Updates**: Watch mode only processes changed files
- **Result Limiting**: Large result sets limited for fast rendering
- **Large-Scale Processing**: Optimized architecture enables efficient processing of **thousands of files** with cost-effective API usage
- **Cost-Efficient**: Can process source folders with **thousands of files** for just a few dollars in OpenRouter API costs
- **Scalable Architecture**: Modular agent design and centralized configuration enable efficient processing of large file collections

## Development

### Adding a New IPC Method

1. Add Zod schemas in `packages/core/src/ipc/contracts.ts`
2. Add handler in `apps/desktop/src/main/ipc-handlers.ts`
3. Expose in `apps/desktop/src/preload/index.ts`
4. Add type to `apps/ui/src/types.d.ts`
5. Use in React components via `window.api.newMethod()`

### Database Schema

The SQLite database stores:

- **sources**: Configured source folders to index
- **files**: Indexed file metadata (path, size, mtime, etc.)
- **folders**: Folder hierarchy information
- **file_content**: Extracted content, summaries, tags, metadata
- **virtual_placements**: AI-generated virtual folder assignments

### Debugging

- **Main Process**: Console logs appear in terminal where Electron was started
- **Renderer**: Use DevTools (press Cmd+Option+I on macOS to open)
- **Database**: Inspect `~/Library/Application Support/Fily/virtual-finder.db`

## Known Issues

1. **First Scan Required**: Files won't appear until you click "Scan" at least once for each source.

2. **File Limit**: Only the first 1000 files are displayed per query for performance. Use search to filter results.

## Roadmap

See [AGENTS.md](./AGENTS.md) for the full architecture vision.

### Completed (v1.1.1) - Production Ready for Large-Scale Processing

| Phase | Features |
|-------|----------|
| 0 | Basic app, crawler, SQLite, flat file list |
| 1 | Watch mode, incremental updates |
| 2 | Virtual folder tree UI |
| 3 | Content extraction pipeline |
| 4 | AI planner integration, taxonomy generation, optimizer |
| 4.5 | **Worker pool optimizations** ✅ - concurrent batch processing (80 workers), efficient API usage, cost-effective processing for thousands of files |
| 5 | **Production Readiness & Stability** ✅ (v1.1.1) - Modular architecture, centralized config, parallel processing, validation, optimizer enhancements - **Ready for thousands of files** |

### Planned Improvements

| Phase | Features |
|-------|----------|
| 5 | **Production Readiness & Stability** ✅ **Complete** (v1.1.1) |
| | - ~~User feedback for missing API key~~ ✅ (prompts to add key when using AI features) |
| | - ~~OpenRouter + OpenAI multi-provider support~~ ✅ |
| | - ~~In-app model selection~~ ✅ |
| | - ~~Error recovery and graceful degradation~~ ✅ (comprehensive fallback results, Promise.allSettled for batch failures) |
| | - ~~Worker pool optimizations~~ ✅ (80 concurrent workers, parallel batch processing) |
| | - ~~Cost-efficient processing~~ ✅ (can process thousands of files for just a few dollars) |
| | - ~~Modular agent architecture~~ ✅ (all agents split into organized folders with clear separation) |
| | - ~~Centralized constants~~ ✅ (all configuration in constants.ts for easy adjustment) |
| | - ~~Parallel subfolder generation~~ ✅ (hierarchical taxonomy uses WorkerPool for parallel processing) |
| | - ~~Optimizer folder creation~~ ✅ (optimizer can create new folders when needed) |
| | - ~~Validation agent integration~~ ✅ (validates plans and fixes logical errors) |
| | - ~~Large-scale file processing~~ ✅ (optimized for thousands of files efficiently) |
| | - ~~Operation cancellation and time limits~~ ✅ (implemented: time limits now enforced) |
| | - ~~Path validation and security~~ ✅ (handled by validator and optimizer agents) |
| | - ~~Enhanced progress tracking~~ ✅ (progress bar gives clear status and confirmation) |
| 6 | **Organization System Enhancements** |
| | - User feedback loop for improving AI organization quality |
| | - Custom rules and placement overrides |
| | - Confidence thresholds and quality metrics |
| | - Manual folder creation and file placement |
| | - Multiple taxonomy templates per source |
| | - Organization history and rollback |
| 7 | **Advanced Sorting & Organization** |
| | - Multi-criteria sorting (date, type, size, relevance) |
| | - Smart folder merging and deduplication |
| | - Cross-source virtual folders |
| | - Dynamic folder suggestions based on usage patterns |
| | - Batch operations and bulk organization |
| | - Export/import virtual organization configurations |
| 8 | **Smart AI Search**   |
| | - Semantic search using AI embeddings |
| | - Natural language queries ("find my tax documents from 2023") |
| | - Content-aware search (find files by meaning, not just keywords) |
| | - Visual search for images and documents |
| | - Search history and saved searches |
| | - Smart search suggestions and autocomplete |
| | - Cross-file relationship discovery |
| 9 | **Future Enhancements** |
| | - Local LLM integration (llama-fs) for privacy-focused organization |
| | - Thumbnail generation and preview system |
| | - Advanced analytics and insights |
| | - Collaboration features (shared virtual organizations) |
| | - Mobile companion app |

## Contributing

Contributions are welcome! Please see [AGENTS.md](./AGENTS.md) for coding conventions and architecture guidelines.

## License

MIT

## Acknowledgments

Fily is inspired by the need for intelligent file organization without the complexity of manual folder management. Built with Electron, React, and modern AI capabilities.
