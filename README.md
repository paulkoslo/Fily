# Virtual Finder v1.0

A local-first macOS desktop application that creates an intelligent, AI-organized virtual file browser. Virtual Finder indexes your files and presents them in a smart virtual folder structure without moving, renaming, or deleting your original files.

## Overview

Virtual Finder solves the problem of disorganized files scattered across your system. Instead of manually organizing thousands of files, Virtual Finder uses AI to understand your content and automatically creates a virtual organization system. Your files stay exactly where they are—Virtual Finder simply provides a smarter way to find and browse them.

### Key Features

- **Virtual Organization**: AI-powered virtual folder structure that organizes files by content, context, and meaning
- **Non-Destructive**: Files are never moved, renamed, or deleted—your originals remain untouched
- **Multiple Source Folders**: Index and organize files from multiple directories simultaneously
- **Intelligent Content Extraction**: Automatically extracts and analyzes content from PDFs, documents, images, audio files, and more
- **AI-Powered Tagging**: Generates intelligent tags and summaries for better searchability
- **Real-Time Indexing**: Watch mode automatically detects and indexes new files as they appear
- **Fast Search**: Search across all indexed files by name, content, tags, or metadata
- **Native Integration**: Opens files with your default macOS applications
- **Local-First**: All data stored locally in SQLite—your files and metadata never leave your machine

## Installation

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- macOS (other platforms not tested)
- OpenAI API key (get one from https://platform.openai.com/api-keys)

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

# Generate environment file
cp .env.example .env

# Edit .env and add your OpenAI API key (required)
# OPENAI_API_KEY=your-api-key-here

# Build all packages
npm run build

# Start the application
npm run start
```

### Running the Application

After building, start the application:

```bash
npm run start
```

The application will launch and you can begin indexing and organizing your files.

### Packaging for Distribution

To create a distributable macOS application:

```bash
cd apps/desktop && npm run package
```

This creates a `.app` bundle in `apps/desktop/out/`.

## Configuration

### Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```bash
# OpenAI API Key (required)
# Required for: content summarization, intelligent tagging, taxonomy generation
# Get your API key from: https://platform.openai.com/api-keys
OPENAI_API_KEY=your-api-key-here
```

**Note**: The OpenAI API key is required for the application to function. The app uses OpenAI's API for content summarization, intelligent tagging, and taxonomy generation.

## How It Works

Virtual Finder operates in four main stages:

1. **Index**: Crawls your source directories, extracts file metadata, and stores everything in a local SQLite database
2. **Extract**: Analyzes file content using specialized extractors for PDFs, documents, images, audio, and more
3. **Organize**: Uses AI agents to generate summaries, tags, and virtual folder placements based on content understanding
4. **Browse**: Presents files in an intelligent virtual folder tree while preserving your original file structure

### Architecture

Virtual Finder is built with a modular architecture:

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
│           ├── agents/   # AI agents (summary, tagging, taxonomy)
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
| AI Integration | OpenAI API |

## Features in Detail

### Content Extraction

Virtual Finder can extract and analyze content from:

- **PDFs**: Text extraction, metadata (title, author, pages), image-based PDF support
- **Documents**: DOCX, XLSX, PPTX with full text and metadata extraction
- **Images**: Caption generation, visual content analysis
- **Audio**: Transcription and content analysis
- **Text Files**: Plain text, markdown, code files

### AI Agents

The application uses specialized AI agents:

- **Summary Agent**: Generates intelligent summaries of file content
- **Tag Agent**: Creates relevant tags based on content, location, and metadata
- **Taxonomy Agent**: Organizes files into logical virtual folder structures

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

- **Batch Operations**: Database inserts and updates batched for efficiency
- **Parallel Processing**: Content extraction runs in parallel with worker pools
- **Incremental Updates**: Watch mode only processes changed files
- **Result Limiting**: Large result sets limited for fast rendering

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

### Completed (v1.0)

| Phase | Features |
|-------|----------|
| 0 | Basic app, crawler, SQLite, flat file list |
| 1 | Watch mode, incremental updates |
| 2 | Virtual folder tree UI |
| 3 | Content extraction pipeline |
| 4 | AI planner integration, taxonomy generation |

### Planned Improvements

| Phase | Features |
|-------|----------|
| 5 | **Production Readiness & Stability** 🔴 |
| | - OpenAI API retry logic and rate limit handling |
| | - User feedback for missing API key and API failures |
| | - Error recovery and graceful degradation |
| | - React Error Boundaries for crash prevention |
| | - Operation cancellation for long-running tasks |
| | - Improved path validation and security |
| | - Replace window.confirm() with proper dialog components |
| | - Enhanced error handling throughout the application |
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
| 8 | **Smart AI Search** 🎯 |
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

Virtual Finder is inspired by the need for intelligent file organization without the complexity of manual folder management. Built with Electron, React, and modern AI capabilities.
