try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const { version } = db.prepare('SELECT sqlite_version() AS version').get();
  db.close();
  console.log(`Native SQLite ready: SQLite ${version}, Electron ${process.versions.electron}, ABI ${process.versions.modules}, ${process.arch}`);
} catch (error) {
  console.error(`SQLite could not initialize: ${error.message}`);
  console.error('Run npm run rebuild from the project root, then npm run doctor.');
  process.exitCode = 1;
}
