import { expect, test } from "vitest";
import { Trie, buildTrie } from "../src/core/trie.js";

test("completes a prefix", () => {
  const t = new Trie();
  for (const w of ["dragon", "drawing", "drama", "cat"]) t.insert(w);
  const words = t.complete("dra").map((s) => s.word).sort();
  expect(words).toEqual(["dragon", "drama", "drawing"]);
});

test("returns empty for an unknown prefix", () => {
  const t = new Trie();
  t.insert("hello");
  expect(t.complete("xyz")).toEqual([]);
});

test("ranks by weight", () => {
  const t = new Trie();
  t.insert("search", 5);
  t.insert("searching", 100);
  t.insert("searches", 50);
  expect(t.complete("search", 2).map((s) => s.word)).toEqual([
    "searching",
    "searches",
  ]);
});

test("an exact word is its own completion", () => {
  const t = new Trie();
  t.insert("go", 3);
  t.insert("golang", 1);
  expect(t.complete("go").map((s) => s.word)).toEqual(["go", "golang"]);
});

test("respects the limit", () => {
  const t = buildTrie(
    Array.from({ length: 50 }, (_, i) => [`test${i}`, i] as [string, number])
  );
  expect(t.complete("test", 5)).toHaveLength(5);
});

test("counts distinct words", () => {
  const t = new Trie();
  t.insert("a");
  t.insert("ab");
  t.insert("a"); // duplicate — weight increases, count doesn't
  expect(t.wordCount).toBe(2);
});

test("fast path matches slow path", () => {
  const t = buildTrie([
    ["search", 5], ["searching", 100], ["searches", 50],
    ["seat", 20], ["sea", 80], ["sequence", 3],
  ]);
  for (const p of ["s", "se", "sea", "search", "z"]) {
    expect(t.complete(p, 5)).toEqual(t.completeSlow(p, 5));
  }
});