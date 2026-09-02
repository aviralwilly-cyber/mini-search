import { parseQuery } from "./query-parser.js";
import type { PackedIndex } from "../types.js";

const DEFAULT_K1 = 1.2; // term frequency saturation
const DEFAULT_B = 0.75; // length normalization strength

export interface TermExplain {
  term: string;
  phrase: boolean;
  df: number;
  idf: number;
  tf: number;
  docLength: number;
  norm: number;
  contribution: number;
}

export interface SearchResult {
  docId: number;
  id: number;
  title: string;
  snippet: string;
  url: string;
  kind: string;
  score: number;
  explain?: TermExplain[];
}

export interface SearchOptions {
  limit?: number;
  k1?: number;
  b?: number;
  explain?: boolean;
}

/**
 * Reusable per-index scratch space. Allocating a Float64Array of docCount on
 * every query would cost more than it saves, so it is created once and cleared
 * selectively after each search.
 *
 * NOTE: this makes searchPacked stateful. Safe here because there is no await
 * inside and Node runs it to completion on one thread — a worker-thread setup
 * would need per-worker scratch.
 */
interface Scratch {
  scores: Float64Array;
  touched: Uint32Array;
}

const scratchCache = new WeakMap<PackedIndex, Scratch>();

function getScratch(idx: PackedIndex): Scratch {
  let s = scratchCache.get(idx);
  if (!s) {
    s = {
      scores: new Float64Array(idx.docCount),
      touched: new Uint32Array(idx.docCount),
    };
    scratchCache.set(idx, s);
  }
  return s;
}

/** Posting lists are sorted by docId, so we can binary search within one. */
function findPosting(
  docIds: Uint32Array,
  start: number,
  end: number,
  docId: number
): number {
  let lo = start;
  let hi = end - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = docIds[mid]!;
    if (v === docId) return mid;
    if (v < docId) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Positions within a posting are also ascending. */
function hasPosition(
  positions: Uint32Array,
  start: number,
  end: number,
  want: number
): boolean {
  let lo = start;
  let hi = end - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = positions[mid]!;
    if (v === want) return true;
    if (v < want) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/**
 * Count how many times a phrase occurs in one document.
 *
 * Walk the first term's positions, then for each subsequent term keep only the
 * candidates where that term sits exactly one position later. Whatever
 * survives every term is a complete phrase occurrence.
 */
function countPhrase(idx: PackedIndex, slots: number[], docId: number): number {
  const ranges: { start: number; end: number }[] = [];

  for (const slot of slots) {
    const s = idx.offsets[slot]!;
    const e = idx.offsets[slot + 1]!;
    const at = findPosting(idx.docIds, s, e, docId);
    if (at < 0) return 0; // one term missing means no phrase
    ranges.push({ start: idx.posOffsets[at]!, end: idx.posOffsets[at + 1]! });
  }

  const first = ranges[0]!;
  let candidates: number[] = [];
  for (let i = first.start; i < first.end; i++) {
    candidates.push(idx.positions[i]!);
  }

  for (let k = 1; k < ranges.length; k++) {
    const { start, end } = ranges[k]!;
    const next: number[] = [];
    for (const p of candidates) {
      if (hasPosition(idx.positions, start, end, p + 1)) next.push(p + 1);
    }
    candidates = next;
    if (candidates.length === 0) return 0;
  }

  return candidates.length;
}

/** Resolve a phrase's terms to slots; null if any term is not in the index. */
function phraseSlots(idx: PackedIndex, phrase: string[]): number[] | null {
  const slots: number[] = [];
  for (const term of phrase) {
    const slot = idx.terms.get(term);
    if (slot === undefined) return null;
    slots.push(slot);
  }
  return slots;
}

/**
 * Every document containing the phrase, with its occurrence count.
 *
 * Driven by the rarest term: its posting list bounds the candidate set, so we
 * check df_min documents instead of intersecting all of them.
 */
function matchPhrase(idx: PackedIndex, slots: number[]): Map<number, number> {
  const out = new Map<number, number>();

  let driver = slots[0]!;
  let smallest = idx.offsets[driver + 1]! - idx.offsets[driver]!;
  for (const slot of slots) {
    const df = idx.offsets[slot + 1]! - idx.offsets[slot]!;
    if (df < smallest) {
      smallest = df;
      driver = slot;
    }
  }

  const start = idx.offsets[driver]!;
  const end = idx.offsets[driver + 1]!;
  for (let i = start; i < end; i++) {
    const docId = idx.docIds[i]!;
    const count = countPhrase(idx, slots, docId);
    if (count > 0) out.set(docId, count);
  }

  return out;
}

export function searchPacked(
  idx: PackedIndex,
  query: string,
  opts: SearchOptions = {}
): SearchResult[] {
  const { limit = 10, k1 = DEFAULT_K1, b = DEFAULT_B, explain = false } = opts;

  const parsed = parseQuery(query);
  const { offsets, docIds, freqs, docLengths, docCount, avgDocLength } = idx;
  const { scores, touched } = getScratch(idx);

  let touchedCount = 0;

  const matchedTerms: { term: string; slot: number; df: number; idf: number }[] = [];
  const matchedPhrases: {
    label: string;
    df: number;
    idf: number;
    hits: Map<number, number>;
  }[] = [];

  // ---- loose terms ----
  for (const term of parsed.terms) {
    const slot = idx.terms.get(term);
    if (slot === undefined) continue;

    const start = offsets[slot]!;
    const end = offsets[slot + 1]!;
    const df = end - start;
    const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    matchedTerms.push({ term, slot, df, idf });

    for (let i = start; i < end; i++) {
      const docId = docIds[i]!;
      const tf = freqs[i]!;
      const norm = 1 - b + b * (docLengths[docId]! / avgDocLength);
      const contribution = idf * ((tf * (k1 + 1)) / (tf + k1 * norm));

      // BM25 contributions are strictly positive, so a zero score means this
      // doc has not been touched yet during this query
      if (scores[docId] === 0) touched[touchedCount++] = docId;
      scores[docId]! += contribution;
    }
  }

  // ---- phrases ----
  // A phrase is scored as a pseudo-term: tf is its occurrence count in the
  // document, df is how many documents contain it at all. Phrases are far
  // rarer than their component words, so idf comes out much higher — an exact
  // phrase match outranks a loose one with no special-casing needed.
  for (const phrase of parsed.phrases) {
    const slots = phraseSlots(idx, phrase);
    if (!slots) continue;

    const phits = matchPhrase(idx, slots);
    if (phits.size === 0) continue;

    const df = phits.size;
    const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    matchedPhrases.push({ label: phrase.join(" "), df, idf, hits: phits });

    for (const [docId, tf] of phits) {
      const norm = 1 - b + b * (docLengths[docId]! / avgDocLength);
      const contribution = idf * ((tf * (k1 + 1)) / (tf + k1 * norm));

      if (scores[docId] === 0) touched[touchedCount++] = docId;
      scores[docId]! += contribution;
    }
  }

  // collect only the docs we actually scored
  const hits: { docId: number; score: number }[] = new Array(touchedCount);
  for (let i = 0; i < touchedCount; i++) {
    const docId = touched[i]!;
    hits[i] = { docId, score: scores[docId]! };
  }

  // reset scratch — cost is proportional to work done, not to docCount
  for (let i = 0; i < touchedCount; i++) scores[touched[i]!] = 0;

  hits.sort((x, y) => y.score - x.score);

  return hits.slice(0, limit).map(({ docId, score }) => {
    const m = idx.docMeta[docId]!;
    const result: SearchResult = {
      docId,
      id: m.id,
      title: m.title,
      snippet: m.snippet,
      url: m.url,
      kind: m.kind,
      score,
    };

    if (explain) {
      const rows: TermExplain[] = [];
      const docLength = docLengths[docId]!;
      const norm = 1 - b + b * (docLength / avgDocLength);

      for (const { term, slot, df, idf } of matchedTerms) {
        const start = offsets[slot]!;
        const end = offsets[slot + 1]!;
        const at = findPosting(docIds, start, end, docId);
        if (at < 0) continue; // this term did not occur in this doc

        const tf = freqs[at]!;
        rows.push({
          term,
          phrase: false,
          df, idf, tf, docLength, norm,
          contribution: idf * ((tf * (k1 + 1)) / (tf + k1 * norm)),
        });
      }

      for (const { label, df, idf, hits: phits } of matchedPhrases) {
        const tf = phits.get(docId);
        if (tf === undefined) continue;
        rows.push({
          term: `"${label}"`,
          phrase: true,
          df, idf, tf, docLength, norm,
          contribution: idf * ((tf * (k1 + 1)) / (tf + k1 * norm)),
        });
      }

      result.explain = rows;
    }

    return result;
  });
}