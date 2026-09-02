/**
 * A crude suffix-stripping stemmer.
 * Deliberately simple — replace with Porter once the pipeline works end to end.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word;

  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("edly")) return word.slice(0, -4);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);

  return word;
}