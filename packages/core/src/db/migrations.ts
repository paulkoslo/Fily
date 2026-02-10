import Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  up: (db: InstanceType<typeof Database>) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      // Sources table - directories to index
      db.prepare(`
        CREATE TABLE IF NOT EXISTS sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        )
      `).run();

      // Files table - indexed file metadata
      db.prepare(`
        CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_id TEXT NOT NULL UNIQUE,
          path TEXT NOT NULL,
          name TEXT NOT NULL,
          extension TEXT NOT NULL,
          size INTEGER NOT NULL,
          mtime INTEGER NOT NULL,
          source_id INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
        )
      `).run();

      // Indexes for files table
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_source_id ON files(source_id)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_name ON files(name)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime)`).run();

      // Virtual placements table - planner decisions
      db.prepare(`
        CREATE TABLE IF NOT EXISTS virtual_placements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_id TEXT NOT NULL UNIQUE,
          virtual_path TEXT NOT NULL,
          tags TEXT NOT NULL,
          confidence REAL NOT NULL,
          reason TEXT NOT NULL,
          planner_version TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
        )
      `).run();

      // Indexes for virtual_placements
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_vp_virtual_path ON virtual_placements(virtual_path)`).run();

      // Settings table - key/value store
      db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `).run();

      // Schema version tracking
      db.prepare(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        )
      `).run();
    },
  },
  {
    version: 2,
    name: 'add_folders_and_hierarchy',
    up: (db) => {
      // Folders table - indexed folder metadata (mirrors real filesystem structure)
      db.prepare(`
        CREATE TABLE IF NOT EXISTS folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folder_id TEXT NOT NULL UNIQUE,
          path TEXT NOT NULL,
          name TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          parent_path TEXT,
          depth INTEGER NOT NULL DEFAULT 0,
          source_id INTEGER NOT NULL,
          item_count INTEGER NOT NULL DEFAULT 0,
          mtime INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
        )
      `).run();

      // Indexes for folders table
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_folders_source_id ON folders(source_id)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_folders_parent_path ON folders(parent_path)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_folders_relative_path ON folders(relative_path)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_folders_depth ON folders(depth)`).run();

      // Add relative_path and parent_path to files table for hierarchy tracking
      try {
        db.prepare(`ALTER TABLE files ADD COLUMN relative_path TEXT`).run();
      } catch (e) {
        // Column might already exist
      }
      try {
        db.prepare(`ALTER TABLE files ADD COLUMN parent_path TEXT`).run();
      } catch (e) {
        // Column might already exist
      }

      // Index for file hierarchy queries
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_parent_path ON files(parent_path)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_relative_path ON files(relative_path)`).run();
    },
  },
  {
    version: 3,
    name: 'add_parent_source_link',
    up: (db) => {
      // Add parent_source_id to sources table for virtual linking
      // When a source is nested inside another source, it links to the parent
      // instead of duplicating files. This creates a virtual filesystem view.
      try {
        db.prepare(`ALTER TABLE sources ADD COLUMN parent_source_id INTEGER`).run();
      } catch (e) {
        // Column might already exist
      }
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sources_parent_source_id ON sources(parent_source_id)`).run();
      
      // Add foreign key constraint (SQLite doesn't support ALTER TABLE ADD CONSTRAINT,
      // but we document it here for reference)
      // When parent source is deleted, child sources should be handled appropriately
    },
  },
  {
    version: 4,
    name: 'add_watch_mode_support',
    up: (db) => {
      // Events table - filesystem change events for watch mode
      db.prepare(`
        CREATE TABLE IF NOT EXISTS events (
          event_id TEXT PRIMARY KEY,
          ts INTEGER NOT NULL,
          source_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          path_old TEXT,
          path_new TEXT NOT NULL,
          FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
        )
      `).run();

      // Indexes for events table
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_events_source_id ON events(source_id)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)`).run();

      // Add status and last_seen to files table for watch mode
      try {
        db.prepare(`ALTER TABLE files ADD COLUMN status TEXT DEFAULT 'present'`).run();
      } catch (e) {
        // Column might already exist
      }
      try {
        db.prepare(`ALTER TABLE files ADD COLUMN last_seen INTEGER`).run();
      } catch (e) {
        // Column might already exist
      }

      // Index for file status queries
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_status ON files(status)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_last_seen ON files(last_seen)`).run();
      
      // Index for path lookups (used by watcher for fast file deletion)
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_path ON files(path)`).run();
    },
  },
  {
    version: 5,
    name: 'add_file_content_table',
    up: (db) => {
      // File content table - stores extracted content from files
      db.prepare(`
        CREATE TABLE IF NOT EXISTS file_content (
          file_id TEXT PRIMARY KEY,
          content_type TEXT NOT NULL,
          extracted_text TEXT,
          summary TEXT,
          keywords TEXT,
          metadata TEXT,
          extracted_at INTEGER NOT NULL,
          extractor_version TEXT NOT NULL,
          error_message TEXT,
          FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
        )
      `).run();
      // Indexes for file_content table
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_file_content_type ON file_content(content_type)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_file_content_extracted_at ON file_content(extracted_at)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_file_content_keywords ON file_content(keywords)`).run();
    },
  },
  {
    version: 6,
    name: 'add_tags_to_file_content',
    up: (db) => {
      // Add tags column to file_content table for Tag Agent output
      db.prepare(`
        ALTER TABLE file_content ADD COLUMN tags TEXT
      `).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_file_content_tags ON file_content(tags)`).run();
    },
  },
];

export function runMigrations(db: InstanceType<typeof Database>): void {
  // Ensure schema_migrations table exists
  db.prepare(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `).run();

  // Get applied migrations
  const applied = new Set<number>();
  const stmt = db.prepare(`SELECT version FROM schema_migrations`);
  const results = stmt.all() as Array<{ version: number }>;
  for (const row of results) {
    applied.add(row.version);
  }

  // Apply pending migrations
  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      console.log(`Applying migration ${migration.version}: ${migration.name}`);
      migration.up(db);
      db.prepare(`
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, Date.now());
    }
  }
}
