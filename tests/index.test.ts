import { expect, test } from "vitest";
import { buildIndex, analyze } from "../src/core/inverted-index.js";
import type { Doc } from "../src/types.js";

const docs: Doc[] = [
  { id: 1, title: "Distributed systems are hard", text: "", url: "", kind: "story" },
  { id: 2, title: "Building a search engine", text: "systems design", url: "", kind: "story" },
  { id: 3, title: "Cats are cute", text: "", url: "", kind: "story" },
];

/** Deliberately naive: scans every doc. The index must agree with this. */
function bruteForce(docs: Doc[], term: string): number[] {
  const stemmed = analyze(term);
  return docs
    .map((d, i) => ({ i, tokens: new Set(analyze(`${d.title} ${d.text}`)) }))
    .filter(({ tokens }) => stemmed.every((t) => tokens.has(t)))
    .map(({ i }) => i);
}

test("posting lists match a linear scan", () => {
  const idx = buildIndex(docs);
  for (const term of ["systems", "search", "cats", "nonexistent"]) {
    const fromIndex = (idx.postings.get(analyze(term)[0] ?? "") ?? []).map((p) => p.docId);
    expect(fromIndex).toEqual(bruteForce(docs, term));
  }
});

test("term frequency counts repeats", () => {
  const idx = buildIndex([
    { id: 1, title: "test test test", text: "", url: "", kind: "story" },
  ]);
  expect(idx.postings.get("test")?.[0]?.termFreq).toBe(3);
});

test("doc stats are correct", () => {
  const idx = buildIndex(docs);
  expect(idx.docCount).toBe(3);
  expect(idx.docLengths).toHaveLength(3);
  expect(idx.avgDocLength).toBeGreaterThan(0);
});