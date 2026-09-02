const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Removes HTML tags and decodes entities. Runs at ingest (so stored text is
 * clean) and inside analyze() (so anything that slipped through is handled).
 */
export function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(\w+);/g, (_m, name: string) => ENTITIES[name.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stopwords are a blunt space/recall tradeoff. BM25's idf term handles the
 * same problem more gracefully at query time, so this list stays limited to
 * pure function words — content-bearing words like "open", "new", "work" are
 * deliberately kept.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "it", "its", "this", "that", "these", "those",
  "for", "with", "as", "by", "from", "into", "about", "over", "after",
  "you", "your", "we", "our", "us", "they", "them", "their",
  "he", "she", "his", "her", "him", "i", "me", "my", "mine",
  "have", "has", "had", "having", "do", "does", "did", "doing",
  "not", "no", "yes", "can", "will", "would", "should", "could", "may", "might",
  "if", "then", "than", "so", "such", "there", "here", "where", "when",
  "what", "which", "who", "whom", "why", "how",
  "all", "any", "both", "each", "few", "more", "most", "other", "some",
  "just", "only", "own", "same", "too", "very", "much", "many",
  "like", "also", "even", "still", "well", "back", "way",
  "one", "two", "up", "out", "down", "off", "again", "once",
]);

export interface PositionedToken {
  token: string;
  /** index in the pre-filter token stream */
  pos: number;
}

/**
 * Tokenize, keeping each surviving token's position in the ORIGINAL stream.
 *
 * Positions are numbered before stopword removal on purpose. If they were
 * numbered after, "machine is learning" would store `machine` and `learn` at
 * adjacent positions once `is` was dropped — and would then falsely match the
 * phrase "machine learning". Numbering pre-filter preserves the gap.
 */
export function tokenizePositions(text: string): PositionedToken[] {
  const raw = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out: PositionedToken[] = [];
  for (let pos = 0; pos < raw.length; pos++) {
    const t = raw[pos]!;
    if (t.length > 1 && !STOPWORDS.has(t)) out.push({ token: t, pos });
  }
  return out;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const { token } of tokenizePositions(text)) out.push(token);
  return out;
}