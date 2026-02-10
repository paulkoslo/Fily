# Quick Start Guide

## Fresh Start (Testing Database Persistence)

```bash
# 1. Install root dependencies
npm install

# 2. Install desktop app dependencies (separate from workspace)
cd apps/desktop && npm install && cd ../..

# 3. Build everything
npm run build

# 4. Start the app
npm run start
```

## Development Mode

```bash
# Terminal 1: Start UI dev server
npm run dev:ui

# Terminal 2: Start Electron (from root)
npm run dev:desktop
```

## Verify Database Path

When the app starts, check the console output. You should see:
```
Database path: /Users/YOUR_USERNAME/Library/Application Support/Fily/virtual-finder.db
```

## Test Database Persistence

1. Start the app: `npm run start`
2. Add a source folder and scan it
3. Close the app
4. Rebuild: `npm run build`
5. Restart: `npm run start`
6. Your sources and files should still be there!

## Clean Build

```bash
# Clean everything
npm run clean

# Reinstall and rebuild
npm install
cd apps/desktop && npm install && cd ../..
npm run build
```
