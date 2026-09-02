import { buildIndex, loadCorpus } from "../core/inverted-index.js";
import { pack } from "../core/packed-index.js";
import { search } from "../core/bm25.js";
import { searchPacked } from "../core/bm25-packed.js";

const docs = await loadCorpus("data/corpus.ndjson");
const idx = buildIndex(docs);

// frequency-weighted sampling: real users search common words, so uniform
// sampling over 68k terms would over-represent the rare tail
const entries = [...idx.postings.entries()];
const cumulative: number[] = [];
let running = 0;
for (const [, list] of entries) {
  running += list.length;
  cumulative.push(running);
}
function weightedTerm(): string {
  const target = Math.random() * running;
  let lo = 0, hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return entries[lo]![0];
}

const queries: string[] = [];
for (let i = 0; i < 1000; i++) {
  queries.push(
    Math.random() < 0.5 ? weightedTerm() : `${weightedTerm()} ${weightedTerm()}`
  );
}

function bench(name: string, fn: (q: string) => unknown) {
  for (let i = 0; i < 200; i++) fn(queries[i % queries.length]!);

  const times: number[] = [];
  const t0 = performance.now();
  for (const q of queries) {
    const s = performance.now();
    fn(q);
    times.push(performance.now() - s);
  }
  const wall = (performance.now() - t0) / 1000;

  times.sort((a, b) => a - b);
  const pct = (p: number) => times[Math.floor(times.length * p)]!.toFixed(3);
  console.log(
    `${name.padEnd(10)} p50 ${pct(0.5)}  p95 ${pct(0.95)}  p99 ${pct(0.99)}  ` +
      `max ${times[times.length - 1]!.toFixed(3)}  ` +
      `${(queries.length / wall).toFixed(0)} qps`
  );
}

const before = process.memoryUsage().heapUsed;
const packed = pack(idx);
const after = process.memoryUsage().heapUsed;

console.log(`${idx.docCount.toLocaleString()} docs, ${packed.docIds.length.toLocaleString()} postings`);
console.log(`packed arrays: ${((packed.docIds.byteLength + packed.freqs.byteLength + packed.offsets.byteLength) / 1024 / 1024).toFixed(1)} MB`);
console.log(`heap delta on pack: ${((after - before) / 1024 / 1024).toFixed(1)} MB\n`);

bench("objects", (q) => search(idx, q, 10));
bench("packed", (q) => searchPacked(packed, q, { limit: 10 }));