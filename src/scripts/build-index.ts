import { buildIndex, loadCorpus } from "../core/inverted-index.js";
import { search } from "../core/bm25.js";

const start = performance.now();
const docs = await loadCorpus("data/corpus.ndjson");
const idx = buildIndex(docs);
const elapsed = performance.now() - start;

console.log(`Indexed ${idx.docCount.toLocaleString()} docs in ${elapsed.toFixed(1)}ms`);
console.log(`Unique terms: ${idx.postings.size.toLocaleString()}`);
console.log(`Avg doc length: ${idx.avgDocLength.toFixed(1)} tokens`);

const totalPostings = [...idx.postings.values()].reduce((a, l) => a + l.length, 0);
console.log(`Total postings: ${totalPostings.toLocaleString()}`);

const mem = process.memoryUsage();
console.log(`Heap used: ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`);

// biggest posting lists — should be common but meaningful words
const top = [...idx.postings.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 10);
console.log("\nMost common terms:");
for (const [term, list] of top) {
  console.log(`  ${term.padEnd(15)} ${list.length.toLocaleString()} docs`);
}

for (const q of ["ai", "open source", "google search"]) {
  console.log(`\n--- "${q}" ---`);
  for (const r of search(idx, q, 5)) {
    const label = r.title || `[comment] ${r.snippet.slice(0, 60)}`;
    console.log(`  ${r.score.toFixed(3)}  ${label.slice(0, 75)}`);
  }
}