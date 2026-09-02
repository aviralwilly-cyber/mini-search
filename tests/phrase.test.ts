import { expect, test } from "vitest";
import {
  analyze,
  analyzePositions,
  buildIndex,
} from "../src/core/inverted-index.js";
import { pack } from "../src/core/packed-index.js";
import { searchPacked } from "../src/core/bm25-packed.js";
import { parseQuery } from "../src/core/query-parser.js";
import type { Doc } from "../src/types.js";

const docs: Doc[] = [
  // 0 — contains the exact phrase
  { id: 1, title: "machine learning is hard", text: "", url: "", kind: "story" },
  // 1 — same words, not adjacent
  { id: 2, title: "learning about machine tools", text: "", url: "", kind: "story" },
  // 2 — words separated by a stopword; must NOT match the phrase
  { id: 3, title: "the machine is learning", text: "", url: "", kind: "story" },
  // 3 — phrase twice, so tf is 2
  { id: 4, title: "machine learning and machine learning", text: "", url: "", kind: "comment" },
  // 4 — only one of the words
  { id: 5, title: "learning to cook", text: "", url: "", kind: "comment" },
];

test("positions are numbered before stopword removal", () => {
  // "the machine is learning" -> the=0 (dropped), machine=1, is=2 (dropped), learning=3
  const terms = analyzePositions("the machine is learning");
  expect(terms.map((t) => t.pos)).toEqual([1, 3]);
});

test("positions are stored ascending per posting", () => {
  const idx = buildIndex(docs);
  // derive the key rather than hardcoding a stem, so this survives a
  // stemmer change
  const key = analyze("machine")[0]!;
  const list = idx.postings.get(key);
  expect(list).toBeDefined();

  for (const p of list!) {
    const sorted = [...p.positions].sort((a, b) => a - b);
    expect(p.positions).toEqual(sorted);
    expect(p.positions.length).toBe(p.termFreq);
  }
});

test("packed positions round-trip through the sentinel", () => {
  const packed = pack(buildIndex(docs));
  expect(packed.posOffsets[packed.posOffsets.length - 1]).toBe(
    packed.positions.length
  );
  // every posting's position span equals its term frequency
  for (let i = 0; i < packed.docIds.length; i++) {
    const span = packed.posOffsets[i + 1]! - packed.posOffsets[i]!;
    expect(span).toBe(packed.freqs[i]!);
  }
});

test("phrase matches only adjacent occurrences", () => {
  const packed = pack(buildIndex(docs));
  const hits = searchPacked(packed, '"machine learning"', { limit: 10 });
  const ids = hits.map((h) => h.docId).sort((a, b) => a - b);

  // doc 0 and doc 3 only — doc 1 has the words out of order, doc 2 has a
  // stopword between them, doc 4 is missing one word entirely
  expect(ids).toEqual([0, 3]);
});

test("a stopword gap prevents a false phrase match", () => {
  const packed = pack(buildIndex(docs));
  const hits = searchPacked(packed, '"machine learning"', { limit: 10 });
  expect(hits.some((h) => h.docId === 2)).toBe(false);
});

test("phrase term frequency counts repeat occurrences", () => {
  const packed = pack(buildIndex(docs));
  const hits = searchPacked(packed, '"machine learning"', {
    limit: 10,
    explain: true,
  });
  const doubled = hits.find((h) => h.docId === 3)!;
  const row = doubled.explain!.find((e) => e.phrase)!;
  expect(row.tf).toBe(2);
});

test("phrase outranks the same words loose", () => {
  const packed = pack(buildIndex(docs));
  const phrase = searchPacked(packed, '"machine learning"', { limit: 10 });
  const loose = searchPacked(packed, "machine learning", { limit: 10 });

  // the loose query reaches documents the phrase query cannot
  expect(loose.length).toBeGreaterThan(phrase.length);
  // and an exact match ranks first under the phrase query
  expect([0, 3]).toContain(phrase[0]!.docId);
});

test("an unknown word in a phrase yields no matches", () => {
  const packed = pack(buildIndex(docs));
  expect(searchPacked(packed, '"machine zzzznope"', { limit: 10 })).toEqual([]);
});

test("phrases and loose terms combine in one query", () => {
  const packed = pack(buildIndex(docs));
  const hits = searchPacked(packed, 'cook "machine learning"', {
    limit: 10,
    explain: true,
  });
  const ids = hits.map((h) => h.docId).sort((a, b) => a - b);
  expect(ids).toEqual([0, 3, 4]);

  // doc 4 matched only the loose term, so it has no phrase row
  const cookHit = hits.find((h) => h.docId === 4)!;
  expect(cookHit.explain!.every((e) => !e.phrase)).toBe(true);
});

test("explain contributions still sum to the total with a phrase", () => {
  const packed = pack(buildIndex(docs));
  const [top] = searchPacked(packed, 'hard "machine learning"', {
    limit: 1,
    explain: true,
  });
  const sum = top!.explain!.reduce((a, e) => a + e.contribution, 0);
  expect(sum).toBeCloseTo(top!.score, 10);
});

test("parser separates phrases from loose terms", () => {
  const p = parseQuery('rust "memory safety" compiler');
  expect(p.phrases).toHaveLength(1);
  expect(p.phrases[0]).toHaveLength(2);
  expect(p.terms).toEqual(analyze("rust compiler"));
});

test("a one-word quote is demoted to a loose term", () => {
  const p = parseQuery('"rust"');
  expect(p.phrases).toHaveLength(0);
  expect(p.terms).toEqual(["rust"]);
});

test("an unterminated quote does not swallow the query", () => {
  const p = parseQuery('rust "memory safety');
  expect(p.phrases).toHaveLength(0);
  // the quote is ignored and its contents fall through as loose terms
  expect(new Set(p.terms)).toEqual(new Set(analyze("rust memory safety")));
});

test("phrase display marks which parts were quoted", () => {
  const p = parseQuery('rust "memory safety"');
  const phrases = p.display.filter((d) => d.phrase);
  const loose = p.display.filter((d) => !d.phrase);
  expect(phrases).toHaveLength(1);
  expect(loose.map((d) => d.text)).toEqual(analyze("rust"));
});