/** Deterministic hashing embeddings for tests and in-memory RAG. */

import { createHash } from "node:crypto";
import type { EmbeddingsProtocol } from "./protocol.js";

export class HashingEmbeddings implements EmbeddingsProtocol {
  constructor(private readonly dim = 64) {
    if (dim < 8) throw new Error("HashingEmbeddings dim must be at least 8");
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const text of texts) {
      const vec = new Array<number>(this.dim).fill(0);
      const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) {
        out.push(vec);
        continue;
      }
      for (const tok of tokens) {
        const digest = createHash("md5").update(tok).digest();
        const idx = digest.readUInt32LE(0) % this.dim;
        vec[idx]! += 1;
      }
      const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
      out.push(vec.map((x) => x / norm));
    }
    return out;
  }
}
