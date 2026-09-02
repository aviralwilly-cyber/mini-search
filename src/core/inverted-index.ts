import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { tokenize, tokenizePositions, stripHtml } from "./tokenizer.js";
import { stem } from "./stemmer.js";
import type { Doc, DocMeta, InvertedIndex, Posting } from "../types.js";

/**
 * The single text-processing pipeline. Both indexing and querying MUST go
 * through this — if the two paths ever diverge, search silently breaks.
 */
export function analyze(text: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(stripHtml(text))) out.push(stem(t));
  return out;
}

export interface PositionedTerm {
  term: string;
  pos: number;
}

/** Same pipeline, but each term keeps its position for phrase matching. */
export function analyzePositions(text: string): PositionedTerm[] {
  const out: PositionedTerm[] = [];
  for (const { token, pos } of tokenizePositions(stripHtml(text))) {
    out.push({ term: stem(token), pos });
  }
  return out;
}

export function buildIndex(docs: Iterable<Doc>): InvertedIndex {
  const postings = new Map<string, Posting[]>();
  const docLengths: number[] = [];
  const docMeta: DocMeta[] = [];
  let docId = 0;
  let totalLength = 0;

  for (const doc of docs) {
    const terms = analyzePositions(`${doc.title} ${doc.text}`);
    docLengths[docId] = terms.length;
    totalLength += terms.length;

    docMeta.push({
      id: doc.id,
      title: doc.title,
      url: doc.url,
      kind: doc.kind,
      snippet: doc.text.slice(0, 160),
    });

    // group positions by term within this doc, so each term appears exactly
    // once per posting list. Positions come out ascending for free because
    // analyzePositions walks the token stream in order.
    const byTerm = new Map<string, number[]>();
    for (const { term, pos } of terms) {
      let arr = byTerm.get(term);
      if (!arr) {
        arr = [];
        byTerm.set(term, arr);
      }
      arr.push(pos);
    }

    for (const [term, positions] of byTerm) {
      let list = postings.get(term);
      if (!list) {
        list = [];
        postings.set(term, list);
      }
      list.push({ docId, termFreq: positions.length, positions });
    }

    docId++;
  }

  return {
    postings,
    docLengths,
    docCount: docId,
    avgDocLength: docId > 0 ? totalLength / docId : 0,
    docMeta,
  };
}

export async function loadCorpus(path: string): Promise<Doc[]> {
  const docs: Doc[] = [];
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) docs.push(JSON.parse(line) as Doc);
  }
  return docs;
}