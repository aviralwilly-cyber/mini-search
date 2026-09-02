import { analyze } from "./inverted-index.js";
import type { InvertedIndex } from "../types.js";

const K1 = 1.2;  // term frequency saturation
const B = 0.75;  // length normalization strength

export interface SearchResult {
  docId: number;
  id: number;
  title: string;
  snippet: string;
  url: string;
  kind: string;
  score: number;
}

export function search(
  idx: InvertedIndex,
  query: string,
  limit = 10
): SearchResult[] {
  const terms = analyze(query);
  const scores = new Map<number, number>();

  for (const term of terms) {
    const list = idx.postings.get(term);
    if (!list) continue;

    // rare terms carry more signal than common ones
    const df = list.length;
    const idf = Math.log(1 + (idx.docCount - df + 0.5) / (df + 0.5));

    for (const { docId, termFreq } of list) {
      const docLen = idx.docLengths[docId] ?? 0;
      const norm = 1 - B + B * (docLen / idx.avgDocLength);
      const tfPart = (termFreq * (K1 + 1)) / (termFreq + K1 * norm);
      scores.set(docId, (scores.get(docId) ?? 0) + idf * tfPart);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([docId, score]) => {
      const m = idx.docMeta[docId]!;
      return {
        docId,
        id: m.id,
        title: m.title,
        snippet: m.snippet,
        url: m.url,
        kind: m.kind,
        score,
      };
    });
}