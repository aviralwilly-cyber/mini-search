import { expect, test } from "vitest";
import { stem } from "../src/core/stemmer.js";

test("strips plural s", () => {
  expect(stem("systems")).toBe("system");
  expect(stem("dogs")).toBe("dog");
});

test("does not strip double s", () => {
  expect(stem("class")).toBe("class");
  expect(stem("process")).toBe("process");
});

test("handles ies plurals", () => {
  expect(stem("queries")).toBe("query");
});

test("strips ing and ed", () => {
  expect(stem("running")).toBe("runn");
  expect(stem("indexed")).toBe("index");
});

test("leaves short words alone", () => {
  expect(stem("is")).toBe("is");
  expect(stem("cat")).toBe("cat");
});