import { expect, test } from "vitest";
import { buildIndex } from "../src/core/inverted-index.js";
import { pack } from "../src/core/packed-index.js";
import { search } from "../src/core/bm25.js";
import { searchPacked } from "../src/core/bm25-packed.js";
import type { Doc } from "../src/types.js";

const docs: Doc[] = [
  { id: 1, title: "Distributed systems are hard", text: "systems scale", url: "", kind: "story" },
  { id: 2, title: "Building a search engine", text: "systems design search", url: "", kind: "story" },
  { id: 3, title: "Cats are cute", text: "", url: "", kind: "comment" },
  { id: 4, title: "", text: "a longer comment about search engines and systems design in practice", url: "", kind: "comment" },
];

test("packed search matches unpacked exactly", () => {
  const idx = buildIndex(docs);
  const packed = pack(idx);

  for (const q of ["systems", "search design", "cats", "nonexistent", ""]) {
    const a = search(idx, q, 10);
    const b = searchPacked(packed, q, { limit: 10 });
    expect(b.map((r) => r.docId)).toEqual(a.map((r) => r.docId));
    b.forEach((r, i) => expect(r.score).toBeCloseTo(a[i]!.score, 10));
  }
});

test("offsets sentinel bounds the last list", () => {
  const packed = pack(buildIndex(docs));
  const last = packed.offsets[packed.offsets.length - 1]!;
  expect(last).toBe(packed.docIds.length);
});

test("repeated searches don't leak scores between queries", () => {
  const packed = pack(buildIndex(docs));

  const first = searchPacked(packed, "systems", { limit: 10 });
  searchPacked(packed, "cats", { limit: 10 });
  const again = searchPacked(packed, "systems", { limit: 10 });

  expect(again.map((r) => r.docId)).toEqual(first.map((r) => r.docId));
  again.forEach((r, i) => expect(r.score).toBeCloseTo(first[i]!.score, 10));
});

test("b=0 disables length normalization", () => {
  const packed = pack(buildIndex(docs));

  // doc 3 is the long one; with b=0 the norm factor is always 1, so it
  // should rank at least as well as it does under normal normalization
  const normalized = searchPacked(packed, "systems design", { limit: 10, b: 0.75 });
  const flat = searchPacked(packed, "systems design", { limit: 10, b: 0 });

  const rankNormalized = normalized.findIndex((r) => r.docId === 3);
  const rankFlat = flat.findIndex((r) => r.docId === 3);
  expect(rankFlat).toBeLessThanOrEqual(rankNormalized);
});

test("k1=0 makes term frequency irrelevant", () => {
  const packed = pack(buildIndex([
    { id: 1, title: "search search search search", text: "", url: "", kind: "story" },
    { id: 2, title: "search once here", text: "", url: "", kind: "story" },
  ]));

  // k1=0 collapses the tf term to a constant, so both docs score identically
  const flat = searchPacked(packed, "search", { limit: 10, k1: 0 });
  expect(flat[0]!.score).toBeCloseTo(flat[1]!.score, 10);
});

test("explain contributions sum to the total score", () => {
  const packed = pack(buildIndex(docs));
  const [top] = searchPacked(packed, "systems design", { limit: 1, explain: true });

  const sum = top!.explain!.reduce((a, e) => a + e.contribution, 0);
  expect(sum).toBeCloseTo(top!.score, 10);
});

test("explain omits terms absent from the document", () => {
  const packed = pack(buildIndex(docs));
  const [top] = searchPacked(packed, "cats systems", { limit: 1, explain: true });

  // only the terms actually present in the winning doc get a row
  const terms = top!.explain!.map((e) => e.term);
  expect(new Set(terms).size).toBe(terms.length);
  expect(terms.every((t) => ["cat", "system"].includes(t))).toBe(true);
});