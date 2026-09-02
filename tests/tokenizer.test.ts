import { expect, test } from "vitest";
import { tokenize } from "../src/core/tokenizer.js";

test("lowercases and strips punctuation", () => {
  expect(tokenize("The Quick, Brown fox!")).toEqual(["quick", "brown", "fox"]);
});

test("removes stopwords", () => {
  expect(tokenize("it is on the table")).toEqual(["table"]);
});

test("keeps numbers", () => {
  expect(tokenize("Node 20 released")).toEqual(["node", "20", "released"]);
});

test("handles empty and whitespace input", () => {
  expect(tokenize("")).toEqual([]);
  expect(tokenize("   ")).toEqual([]);
});

test("is idempotent on already-tokenized text", () => {
  const once = tokenize("Distributed Systems Design");
  expect(tokenize(once.join(" "))).toEqual(once);
});