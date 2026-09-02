import type { InvertedIndex, PackedIndex } from "../types.js";

export function pack(idx: InvertedIndex): PackedIndex {
  const terms = new Map<string, number>();
  const slotCount = idx.postings.size;

  let totalPostings = 0;
  let totalPositions = 0;
  for (const list of idx.postings.values()) {
    totalPostings += list.length;
    for (const p of list) totalPositions += p.positions.length;
  }

  const offsets = new Uint32Array(slotCount + 1);
  const docIds = new Uint32Array(totalPostings);
  const freqs = new Uint32Array(totalPostings);
  const posOffsets = new Uint32Array(totalPostings + 1);
  const positions = new Uint32Array(totalPositions);

  let slot = 0;
  let cursor = 0;   // index into docIds / freqs
  let pcursor = 0;  // index into positions

  for (const [term, list] of idx.postings) {
    terms.set(term, slot);
    offsets[slot] = cursor;

    for (const p of list) {
      docIds[cursor] = p.docId;
      freqs[cursor] = p.termFreq;
      posOffsets[cursor] = pcursor;

      for (const pos of p.positions) positions[pcursor++] = pos;
      cursor++;
    }

    slot++;
  }

  offsets[slot] = cursor;      // sentinel
  posOffsets[cursor] = pcursor; // sentinel

  return {
    terms,
    offsets,
    docIds,
    freqs,
    posOffsets,
    positions,
    docLengths: Uint32Array.from(idx.docLengths),
    docCount: idx.docCount,
    avgDocLength: idx.avgDocLength,
    docMeta: idx.docMeta,
  };
}