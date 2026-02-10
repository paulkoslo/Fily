/**
 * Performance Benchmark Suite
 * 
 * Tests the performance improvements for:
 * 1. Batch database inserts vs individual inserts
 * 2. Pre-computed file counts vs recursive counting
 * 
 * Run with: npm run benchmark
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { DatabaseManager } from '../db';
import { VirtualTreeBuilder } from '../virtual-tree';
import type { FileRecord, PlannerOutput } from '../ipc/contracts';
import { StubPlanner } from '../planner';

// Helper to create a temporary database for testing
function createTempDatabase(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fily-benchmark-'));
  return path.join(tempDir, 'benchmark.db');
}

// Generate mock file records for testing
function generateMockFiles(count: number): FileRecord[] {
  const extensions = ['pdf', 'jpg', 'mp4', 'js', 'txt', 'docx', 'xlsx', 'zip'];
  const files: FileRecord[] = [];
  
  for (let i = 0; i < count; i++) {
    const ext = extensions[i % extensions.length];
    files.push({
      id: i + 1,
      file_id: `file_${i}_${Date.now()}_${Math.random()}`,
      path: `/test/path/file_${i}.${ext}`,
      name: `file_${i}.${ext}`,
      extension: ext,
      size: Math.floor(Math.random() * 10_000_000), // Random size up to 10MB
      mtime: Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000, // Random time in last 30 days
      source_id: 1,
      relative_path: `file_${i}.${ext}`,
      parent_path: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  }
  
  return files;
}

// Benchmark 1: Batch inserts vs individual inserts
async function benchmarkDatabaseInserts(fileCounts: number[]): Promise<void> {
  console.log('\n📊 Benchmark 1: Database Insert Performance\n');
  console.log('Testing batch inserts vs individual inserts...\n');
  
  for (const count of fileCounts) {
    console.log(`Testing with ${count.toLocaleString()} files:`);
    
    // Generate test data
    const files = generateMockFiles(count);
    const planner = new StubPlanner();
    const outputs = await planner.plan(files);
    
    // Test individual inserts
    const db1 = new DatabaseManager(createTempDatabase());
    const start1 = Date.now();
    for (const output of outputs) {
      await db1.upsertVirtualPlacement(output, planner.version);
    }
    const time1 = Date.now() - start1;
    await db1.close();
    
    // Test batch inserts
    const db2 = new DatabaseManager(createTempDatabase());
    const start2 = Date.now();
    const BATCH_SIZE = 1000;
    for (let i = 0; i < outputs.length; i += BATCH_SIZE) {
      const batch = outputs.slice(i, i + BATCH_SIZE);
      await db2.upsertVirtualPlacementBatch(batch, planner.version);
    }
    const time2 = Date.now() - start2;
    await db2.close();
    
    const speedup = (time1 / time2).toFixed(2);
    console.log(`  Individual inserts: ${time1}ms`);
    console.log(`  Batch inserts:      ${time2}ms`);
    console.log(`  Speedup:            ${speedup}x faster`);
    console.log(`  Throughput:         ${Math.round(count / (time2 / 1000)).toLocaleString()} files/sec\n`);
  }
}

// Benchmark 2: File count computation
async function benchmarkFileCounts(fileCounts: number[]): Promise<void> {
  console.log('\n📊 Benchmark 2: File Count Computation Performance\n');
  console.log('Testing pre-computed counts vs recursive counting...\n');
  
  for (const count of fileCounts) {
    console.log(`Testing with ${count.toLocaleString()} files:`);
    
    // Generate test data and build tree
    const files = generateMockFiles(count);
    const planner = new StubPlanner();
    const outputs = await planner.plan(files);
    
    const fileRecordsMap = new Map<string, FileRecord>();
    files.forEach(f => fileRecordsMap.set(f.file_id, f));
    
    const builder = new VirtualTreeBuilder();
    const tree = builder.build(outputs, fileRecordsMap);
    
    // Test recursive counting (old way)
    const countRecursively = (node: any): number => {
      if (node.type === 'file') return 1;
      let total = 0;
      for (const child of node.children) {
        total += countRecursively(child);
      }
      return total;
    };
    
    const start1 = Date.now();
    const iterations = 100; // Count 100 times to get measurable time
    for (let i = 0; i < iterations; i++) {
      countRecursively(tree);
    }
    const time1 = Date.now() - start1;
    const avgTime1 = time1 / iterations;
    
    // Test pre-computed counts (new way)
    const start2 = Date.now();
    for (let i = 0; i < iterations; i++) {
      // Access fileCount property (already computed during build)
      const _count = tree.fileCount ?? 0;
    }
    const time2 = Date.now() - start2;
    const avgTime2 = time2 / iterations;
    
    const speedup = avgTime1 > 0 ? (avgTime1 / Math.max(avgTime2, 0.001)).toFixed(2) : 'N/A';
    console.log(`  Recursive counting: ${avgTime1.toFixed(3)}ms per count`);
    console.log(`  Pre-computed:       ${avgTime2.toFixed(3)}ms per count`);
    console.log(`  Speedup:           ${speedup}x faster\n`);
  }
}

// Benchmark 3: Tree building performance
async function benchmarkTreeBuilding(fileCounts: number[]): Promise<void> {
  console.log('\n📊 Benchmark 3: Tree Building Performance\n');
  console.log('Testing tree building with file count computation...\n');
  
  for (const count of fileCounts) {
    console.log(`Testing with ${count.toLocaleString()} files:`);
    
    const files = generateMockFiles(count);
    const planner = new StubPlanner();
    const outputs = await planner.plan(files);
    
    const fileRecordsMap = new Map<string, FileRecord>();
    files.forEach(f => fileRecordsMap.set(f.file_id, f));
    
    const builder = new VirtualTreeBuilder();
    
    // Measure tree building time
    const start = Date.now();
    const tree = builder.build(outputs, fileRecordsMap);
    const time = Date.now() - start;
    
    console.log(`  Build time:        ${time}ms`);
    console.log(`  Files processed:   ${count.toLocaleString()}`);
    console.log(`  Throughput:        ${Math.round(count / (time / 1000)).toLocaleString()} files/sec`);
    console.log(`  Root file count:   ${tree.fileCount?.toLocaleString() ?? 'N/A'}\n`);
  }
}

// Main benchmark runner
async function runBenchmarks(): Promise<void> {
  console.log('🚀 Virtual Finder Performance Benchmarks\n');
  console.log('=' .repeat(60));
  
  // Test with different file counts
  const testSizes = [100, 1000, 10000];
  
  try {
    await benchmarkDatabaseInserts(testSizes);
    await benchmarkFileCounts(testSizes);
    await benchmarkTreeBuilding(testSizes);
    
    console.log('=' .repeat(60));
    console.log('\n✅ All benchmarks completed!\n');
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runBenchmarks().catch(console.error);
}

export { runBenchmarks };
