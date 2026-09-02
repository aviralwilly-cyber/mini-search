import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { analyze, buildIndex, loadCorpus } from "./core/inverted-index.js";
import { pack } from "./core/packed-index.js";
import { searchPacked } from "./core/bm25-packed.js";
import { parseQuery } from "./core/query-parser.js";
import { buildTrie } from "./core/trie.js";

const buildStart = performance.now();
const docs = await loadCorpus("data/corpus.ndjson");
const raw = buildIndex(docs);
const idx = pack(raw);
const buildMs = performance.now() - buildStart;

console.log(
  `Index ready: ${idx.docCount.toLocaleString()} docs, ` +
    `${idx.terms.size.toLocaleString()} terms, ` +
    `${idx.docIds.length.toLocaleString()} postings, ` +
    `${idx.positions.length.toLocaleString()} positions in ${buildMs.toFixed(0)}ms`
);

// weight each term by document frequency, which the offsets give us for free
// — so common terms surface first in autocomplete
const trie = buildTrie(
  [...idx.terms.entries()].map(([term, slot]) => [
    term,
    idx.offsets[slot + 1]! - idx.offsets[slot]!,
  ])
);
console.log(`Trie ready: ${trie.wordCount.toLocaleString()} terms`);

const app = Fastify({ logger: false });

await app.register(fastifyStatic, {
  root: join(import.meta.dirname, "..", "public"),
});

app.get<{
  Querystring: {
    q?: string;
    limit?: string;
    k1?: string;
    b?: string;
    explain?: string;
  };
}>("/search", async (req, reply) => {
  const q = req.query.q?.trim() ?? "";
  if (!q) return reply.code(400).send({ error: "missing query parameter q" });

  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const k1 = req.query.k1 !== undefined ? Number(req.query.k1) : 1.2;
  const b = req.query.b !== undefined ? Number(req.query.b) : 0.75;
  const explain = req.query.explain === "true";

  if (!Number.isFinite(k1) || k1 < 0 || !Number.isFinite(b) || b < 0 || b > 1) {
    return reply.code(400).send({ error: "k1 must be >= 0 and b in [0, 1]" });
  }

  const parsed = parseQuery(q);
  const start = performance.now();
  const results = searchPacked(idx, q, { limit, k1, b, explain });
  const tookMs = performance.now() - start;

  return {
    query: q,
    parsed: parsed.display,
    k1,
    b,
    tookMs: Number(tookMs.toFixed(4)),
    total: results.length,
    results,
  };
});

app.get<{ Querystring: { prefix?: string; limit?: string } }>(
  "/suggest",
  async (req, reply) => {
    const prefix = req.query.prefix?.trim().toLowerCase() ?? "";
    if (!prefix) return reply.code(400).send({ error: "missing prefix" });

    const limit = Math.min(Number(req.query.limit) || 8, 20);
    const start = performance.now();
    const suggestions = trie.complete(prefix, limit);

    return {
      prefix,
      tookMs: Number((performance.now() - start).toFixed(4)),
      suggestions,
    };
  }
);

app.get<{ Querystring: { term?: string } }>("/postings", async (req, reply) => {
  const rawTerm = req.query.term?.trim() ?? "";
  if (!rawTerm) return reply.code(400).send({ error: "missing term" });

  // run it through the same pipeline the indexer used
  const term = analyze(rawTerm)[0];
  if (!term) return { raw: rawTerm, term: null, df: 0, idf: 0, sample: [] };

  const slot = idx.terms.get(term);
  if (slot === undefined) {
    return { raw: rawTerm, term, df: 0, idf: 0, sample: [] };
  }

  const start = idx.offsets[slot]!;
  const end = idx.offsets[slot + 1]!;
  const df = end - start;

  const sample: { docId: number; tf: number; positions: number[] }[] = [];
  for (let i = start; i < Math.min(start + 20, end); i++) {
    const ps: number[] = [];
    const pe = Math.min(idx.posOffsets[i]! + 6, idx.posOffsets[i + 1]!);
    for (let j = idx.posOffsets[i]!; j < pe; j++) ps.push(idx.positions[j]!);
    sample.push({ docId: idx.docIds[i]!, tf: idx.freqs[i]!, positions: ps });
  }

  return {
    raw: rawTerm,
    term,
    slot,
    df,
    idf: Math.log(1 + (idx.docCount - df + 0.5) / (df + 0.5)),
    sample,
  };
});

app.get("/stats", async () => ({
  docCount: idx.docCount,
  uniqueTerms: idx.terms.size,
  totalPostings: idx.docIds.length,
  totalPositions: idx.positions.length,
  avgDocLength: Number(idx.avgDocLength.toFixed(2)),
  indexBytes:
    idx.docIds.byteLength +
    idx.freqs.byteLength +
    idx.offsets.byteLength +
    idx.posOffsets.byteLength +
    idx.positions.byteLength,
  buildMs: Number(buildMs.toFixed(0)),
}));

const port = Number(process.env.PORT) || 3000;
await app.listen({ port, host: "0.0.0.0" });
console.log(`Listening on http://localhost:${port}`);