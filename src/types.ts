export interface Doc {
  id: number;
  title: string;
  text: string;
  url: string;
  kind: "story" | "comment";
}

export interface Posting {
  docId: number;      // internal sequential id, not the source id
  termFreq: number;   // occurrences of this term in this doc
  positions: number[]; // where those occurrences are, ascending
}

export interface DocMeta {
  id: number;
  title: string;
  url: string;
  kind: "story" | "comment";
  snippet: string;
}

export interface InvertedIndex {
  postings: Map<string, Posting[]>;
  docLengths: number[];
  docCount: number;
  avgDocLength: number;
  docMeta: DocMeta[];
}

// Flat-array form of InvertedIndex. Each posting is a fixed-size slot of
// contiguous memory rather than a heap-allocated object, which cuts memory
// dramatically and makes iterating a posting list a linear scan instead of
// pointer chasing.
export interface PackedIndex {
  // term -> slot number
  terms: Map<string, number>;
  // slot -> start position in docIds/freqs. Length is slotCount + 1, so the
  // postings for slot s are always [offsets[s], offsets[s + 1]) — the trailing
  // sentinel removes the special case for the last slot.
  offsets: Uint32Array;
  docIds: Uint32Array;
  freqs: Uint32Array;
  // posting index -> start position in `positions`. Same sentinel trick, so
  // the positions for posting i are [posOffsets[i], posOffsets[i + 1]).
  //
  // This is technically the prefix sum of `freqs` and could be recomputed
  // rather than stored — but recomputing means an O(n) scan to find any one
  // start, so we spend 4 bytes per posting to keep the lookup O(1).
  posOffsets: Uint32Array;
  positions: Uint32Array;
  docLengths: Uint32Array;
  docCount: number;
  avgDocLength: number;
  docMeta: DocMeta[];
}