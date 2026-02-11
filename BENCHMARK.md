# Performance Benchmark Guide

This guide explains how to test and verify the performance improvements made to Fily.

## Quick Test: Real-World Performance

The easiest way to test performance is to use the app and check the console logs:

1. **Start the app in development mode:**
   ```bash
   npm run dev
   ```

2. **Open the app and organize a source:**
   - Add a source folder with files
   - Click "Organize"
   - Watch the console output for performance metrics

3. **Check the console logs** - You'll see timing information like:
   ```
   [Performance] Planner processed 10,000 files in 150ms (66,667 files/sec)
   [Performance] Batch 1: Stored 1,000 placements in 45ms (22,222 files/sec)
   [Performance] Stored 10,000 placements in 420ms (23,810 files/sec)
   [Performance] Total organization time: 570ms (17,544 files/sec)
   ```

## Automated Benchmark Suite

For more detailed performance testing, run the benchmark suite:

### Prerequisites

Install `tsx` to run TypeScript files directly:
```bash
npm install -D tsx
```

### Run Benchmarks

```bash
npm run benchmark
```

This will run three benchmark tests:

1. **Database Insert Performance** - Compares batch inserts vs individual inserts
2. **File Count Computation** - Compares pre-computed counts vs recursive counting
3. **Tree Building Performance** - Measures overall tree building time

### Expected Results

For 10,000 files:
- **Batch inserts**: ~400-500ms (vs ~30,000ms for individual inserts)
- **Pre-computed counts**: ~0.001ms per lookup (vs ~50ms for recursive counting)
- **Tree building**: ~100-200ms total

## Performance Metrics to Watch

### Before Optimizations (Expected)
- **550k files**: ~30-45 minutes to organize
- **UI freezes**: 5-10 seconds when rendering virtual tree
- **File count display**: Slow, recursive counting on every render

### After Optimizations (Expected)
- **550k files**: ~30 seconds to organize (~60x faster)
- **UI rendering**: Instant, no freezes
- **File count display**: Instant, O(1) property access

## Manual Testing Checklist

### Test 1: Small Source (100-1000 files)
- [ ] Organize completes in < 1 second
- [ ] Virtual tree renders instantly
- [ ] File counts display correctly
- [ ] No UI freezes when expanding folders

### Test 2: Medium Source (1k-10k files)
- [ ] Organize completes in < 5 seconds
- [ ] Virtual tree renders in < 1 second
- [ ] Smooth navigation through folders
- [ ] File counts update instantly

### Test 3: Large Source (10k+ files)
- [ ] Organize completes in < 30 seconds
- [ ] Progress updates show accurate counts
- [ ] Virtual tree renders smoothly
- [ ] No memory issues or crashes

### Test 4: Very Large Source (100k+ files)
- [ ] Organize completes in < 5 minutes
- [ ] Progress updates every second or so
- [ ] App remains responsive during organization
- [ ] Virtual tree loads without freezing

## Real-World Performance Results

### Test Case: 220,122 Files

**Date:** Performance test after implementing batch inserts and pre-computed file counts

**Results:**
```
[Performance] Planner processed 220,122 files in 115ms (1,914,104 files/sec)
[Performance] Batch 1: Stored 1,000 placements in 82ms (12,195 files/sec)
[Performance] Batch 11: Stored 1,000 placements in 13ms (76,923 files/sec)
[Performance] Batch 21: Stored 1,000 placements in 9ms (111,111 files/sec)
[Performance] Batch 31: Stored 1,000 placements in 30ms (33,333 files/sec)
[Performance] Batch 41: Stored 1,000 placements in 37ms (27,027 files/sec)
[Performance] Batch 51: Stored 1,000 placements in 32ms (31,250 files/sec)
[Performance] Batch 61: Stored 1,000 placements in 38ms (26,316 files/sec)
[Performance] Batch 71: Stored 1,000 placements in 39ms (25,641 files/sec)
[Performance] Batch 81: Stored 1,000 placements in 37ms (27,027 files/sec)
[Performance] Batch 91: Stored 1,000 placements in 39ms (25,641 files/sec)
[Performance] Batch 101: Stored 1,000 placements in 47ms (21,277 files/sec)
[Performance] Batch 111: Stored 1,000 placements in 48ms (20,833 files/sec)
[Performance] Batch 121: Stored 1,000 placements in 22ms (45,455 files/sec)
[Performance] Batch 131: Stored 1,000 placements in 15ms (66,667 files/sec)
[Performance] Batch 141: Stored 1,000 placements in 40ms (25,000 files/sec)
[Performance] Batch 151: Stored 1,000 placements in 43ms (23,256 files/sec)
[Performance] Batch 161: Stored 1,000 placements in 59ms (16,949 files/sec)
[Performance] Batch 171: Stored 1,000 placements in 52ms (19,231 files/sec)
[Performance] Batch 181: Stored 1,000 placements in 47ms (21,277 files/sec)
[Performance] Batch 191: Stored 1,000 placements in 41ms (24,390 files/sec)
[Performance] Batch 201: Stored 1,000 placements in 38ms (26,316 files/sec)
[Performance] Batch 211: Stored 1,000 placements in 43ms (23,256 files/sec)
[Performance] Batch 221: Stored 122 placements in 5ms (24,400 files/sec)
[Performance] Stored 220,122 placements in 8315ms (26,473 files/sec)
[Performance] Total organization time: 8430ms (26,112 files/sec)
[Performance] Computed file counts for tree with 220,122 files in 18ms
```

**Summary:**
- **Total files:** 220,122
- **Planner time:** 115ms (1.9M files/sec)
- **Database storage time:** 8,315ms (26,473 files/sec)
- **Total organization time:** 8,430ms (~8.4 seconds)
- **File count computation:** 18ms
- **Average batch throughput:** ~25,000-30,000 files/sec
- **Performance improvement:** ~320x faster than estimated individual inserts (would have taken ~45 minutes)

**Key Observations:**
- First batch is slower (82ms) due to database initialization
- Subsequent batches average 30-40ms per 1,000 files
- Some batches achieve 66,000-111,000 files/sec (very fast)
- File count computation is extremely fast (18ms for 220k files)
- Overall throughput: ~26,000 files/sec sustained

## Performance Monitoring

### Console Logs

The app logs performance metrics to the console:
- Planner processing time
- Batch insert times
- Total organization time
- File count computation time (for large trees)

### What to Look For

**Good Performance:**
- Batch inserts: 20,000+ files/sec
- Tree building: 50,000+ files/sec
- File count lookup: < 0.01ms

**Poor Performance (needs investigation):**
- Batch inserts: < 5,000 files/sec
- Tree building: < 10,000 files/sec
- UI freezes > 1 second

## Troubleshooting

### If benchmarks are slow:
1. Check if you're running in development mode (slower than production)
2. Ensure you have enough disk space for temp databases
3. Check system resources (CPU, memory)

### If real-world performance differs:
1. Check console logs for actual timing
2. Verify batch size is 1000 (check IPC handler)
3. Ensure fileCount is being computed (check tree builder)
4. Check database file size and location

## Benchmark Output Example

```
🚀 Fily Performance Benchmarks
============================================================

📊 Benchmark 1: Database Insert Performance

Testing with 100 files:
  Individual inserts: 45ms
  Batch inserts:      2ms
  Speedup:            22.50x faster
  Throughput:         50,000 files/sec

Testing with 1,000 files:
  Individual inserts: 420ms
  Batch inserts:      18ms
  Speedup:            23.33x faster
  Throughput:         55,556 files/sec

Testing with 10,000 files:
  Individual inserts: 4,200ms
  Batch inserts:      180ms
  Speedup:            23.33x faster
  Throughput:         55,556 files/sec

📊 Benchmark 2: File Count Computation Performance

Testing with 100 files:
  Recursive counting: 0.050ms per count
  Pre-computed:       0.001ms per count
  Speedup:           50.00x faster

📊 Benchmark 3: Tree Building Performance

Testing with 10,000 files:
  Build time:        120ms
  Files processed:   10,000
  Throughput:        83,333 files/sec
  Root file count:   10,000

============================================================
✅ All benchmarks completed!
```
