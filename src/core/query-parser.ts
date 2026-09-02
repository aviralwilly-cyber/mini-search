import { analyze } from "./inverted-index.js";

export interface ParsedQuery {
  /** loose terms, matched anywhere in the document */
  terms: string[];
  /** each phrase is 2+ analysed terms that must appear consecutively */
  phrases: string[][];
  /** what the user typed, normalised for display */
  display: { text: string; phrase: boolean }[];
}

/**
 * Splits a raw query into loose terms and quoted phrases.
 *
 *   rust "memory safety" compiler
 *     → terms:   ["rust", "compil"]
 *       phrases: [["memori", "safeti"]]
 *
 * A quoted string that analyses to a single term is demoted to a loose term —
 * a one-word phrase is just a word, and treating it as a phrase would cost an
 * intersection pass for nothing.
 */
export function parseQuery(raw: string): ParsedQuery {
  const phrases: string[][] = [];
  const display: { text: string; phrase: boolean }[] = [];
  const looseSource: string[] = [];

  // pull out quoted segments; unterminated quotes are ignored and their
  // contents fall through as loose terms
  const rest = raw.replace(/"([^"]*)"/g, (_match, inner: string) => {
    const terms = analyze(inner);
    if (terms.length >= 2) {
      phrases.push(terms);
      display.push({ text: terms.join(" "), phrase: true });
    } else if (terms.length === 1) {
      looseSource.push(terms[0]!);
    }
    return " ";
  });

  const terms = [...looseSource, ...analyze(rest)];
  for (const t of terms) display.push({ text: t, phrase: false });

  return { terms, phrases, display };
}