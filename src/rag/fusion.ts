/** Reciprocal Rank Fusion for hybrid retrieval. */

import type { DocumentChunk } from "./protocol.js";

export function reciprocalRankFusion(
  rankedLists: DocumentChunk[][],
  opts: { k?: number; topN?: number } = {},
): DocumentChunk[] {
  const k = opts.k ?? 60;
  const topN = opts.topN ?? 50;
  const scores = new Map<string, number>();
  const listCounts = new Map<string, number>();
  const byId = new Map<string, DocumentChunk>();
  for (const ranked of rankedLists) {
    ranked.forEach((chunk, idx) => {
      byId.set(chunk.id, chunk);
      scores.set(chunk.id, (scores.get(chunk.id) ?? 0) + 1 / (k + idx + 1));
      listCounts.set(chunk.id, (listCounts.get(chunk.id) ?? 0) + 1);
    });
  }
  const ordered = [...scores.keys()].sort((a, b) => {
    const scoreDiff = (scores.get(b) ?? 0) - (scores.get(a) ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (listCounts.get(b) ?? 0) - (listCounts.get(a) ?? 0);
  });
  return ordered.slice(0, topN).map((id) => byId.get(id)!);
}
