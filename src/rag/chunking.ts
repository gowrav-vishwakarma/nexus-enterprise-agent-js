/** Text chunking utilities. */

import { createHash } from "node:crypto";
import type { DocumentChunk } from "./protocol.js";

export function chunkText(
  text: string,
  opts: { chunkSize?: number; overlap?: number } = {},
): string[] {
  const chunkSize = opts.chunkSize ?? 512;
  const overlap = opts.overlap ?? 64;
  if (!text) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function chunkId(text: string, index: number): string {
  const digest = createHash("sha256")
    .update(`${index}:${text}`)
    .digest("hex")
    .slice(0, 16);
  return `chk_${digest}`;
}

export class FixedChunker {
  constructor(
    private readonly chunkSize = 512,
    private readonly overlap = 64,
  ) {}

  async chunk(
    text: string,
    opts: { metadata?: Record<string, unknown> | null } = {},
  ): Promise<DocumentChunk[]> {
    const meta = { ...(opts.metadata ?? {}) };
    return chunkText(text, {
      chunkSize: this.chunkSize,
      overlap: this.overlap,
    }).map((piece, i) => ({
      id: chunkId(piece, i),
      text: piece,
      metadata: { ...meta, chunkIndex: i },
    }));
  }
}

function recursiveSplit(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) return text ? [text] : [];
  for (const sep of ["\n\n", "\n", ". ", " "]) {
    if (!text.includes(sep)) continue;
    const parts = text.split(sep);
    const acc: string[] = [];
    let buf = "";
    for (const part of parts) {
      const candidate = buf ? buf + sep + part : part;
      if (candidate.length <= chunkSize) buf = candidate;
      else {
        if (buf) acc.push(...recursiveSplit(buf, chunkSize));
        buf = part;
      }
    }
    if (buf) acc.push(...recursiveSplit(buf, chunkSize));
    return acc;
  }
  return chunkText(text, { chunkSize, overlap: 0 });
}

export class RecursiveChunker {
  constructor(
    private readonly chunkSize = 512,
    private readonly overlap = 64,
  ) {}

  async chunk(
    text: string,
    opts: { metadata?: Record<string, unknown> | null } = {},
  ): Promise<DocumentChunk[]> {
    const meta = { ...(opts.metadata ?? {}) };
    let pieces = recursiveSplit(text, this.chunkSize);
    if (this.overlap && pieces.length > 1) {
      const out = [pieces[0]!];
      for (let i = 1; i < pieces.length; i++) {
        const prev = pieces[i - 1]!;
        const prefix =
          prev.length > this.overlap ? prev.slice(-this.overlap) : prev;
        out.push(prefix + pieces[i]!);
      }
      pieces = out;
    }
    return pieces
      .filter((p) => p.trim())
      .map((piece, i) => ({
        id: chunkId(piece, i),
        text: piece,
        metadata: { ...meta, chunkIndex: i },
      }));
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}

export class SemanticChunker {
  constructor(
    private readonly embeddings: { embed(texts: string[]): Promise<number[][]> } | null = null,
    private readonly chunkSize = 512,
    private readonly overlap = 64,
    private readonly threshold = 0.35,
  ) {}

  async chunk(
    text: string,
    opts: { metadata?: Record<string, unknown> | null } = {},
  ): Promise<DocumentChunk[]> {
    if (!this.embeddings) {
      return new RecursiveChunker(this.chunkSize, this.overlap).chunk(text, opts);
    }
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length <= 1) {
      return new FixedChunker(this.chunkSize, this.overlap).chunk(text, opts);
    }
    const vectors = await this.embeddings.embed(sentences);
    const groups: string[][] = [[sentences[0]!]];
    for (let i = 1; i < sentences.length; i++) {
      const sim = cosine(vectors[i - 1]!, vectors[i]!);
      const curLen = groups[groups.length - 1]!.join(" ").length;
      if (sim < this.threshold || curLen >= this.chunkSize) {
        groups.push([sentences[i]!]);
      } else {
        groups[groups.length - 1]!.push(sentences[i]!);
      }
    }
    const meta = { ...(opts.metadata ?? {}) };
    return groups.map((group, i) => {
      const piece = group.join(" ");
      return {
        id: chunkId(piece, i),
        text: piece,
        metadata: { ...meta, chunkIndex: i },
      };
    });
  }
}

export class ContextualChunker {
  constructor(
    private readonly inner: ChunkerLike,
    private readonly context?: string | null,
  ) {}

  async chunk(
    text: string,
    opts: { metadata?: Record<string, unknown> | null } = {},
  ): Promise<DocumentChunk[]> {
    const meta = { ...(opts.metadata ?? {}) };
    const ctx =
      this.context ?? (meta.context as string | undefined) ?? text.slice(0, 200).trim();
    const chunks = await this.inner.chunk(text, { metadata: meta });
    if (!ctx) return chunks;
    const prefix = `Context: ${ctx}\n\n`;
    return chunks.map((chunk) => ({
      ...chunk,
      text: prefix + chunk.text,
      metadata: { ...chunk.metadata, contextual: true },
    }));
  }
}

interface ChunkerLike {
  chunk(
    text: string,
    opts?: { metadata?: Record<string, unknown> | null },
  ): Promise<DocumentChunk[]>;
}

class IdentityChunker implements ChunkerLike {
  async chunk(
    text: string,
    opts: { metadata?: Record<string, unknown> | null } = {},
  ): Promise<DocumentChunk[]> {
    if (!text) return [];
    return [
      {
        id: chunkId(text, 0),
        text,
        metadata: { ...(opts.metadata ?? {}) },
      },
    ];
  }
}

export function buildChunker(
  strategy: string,
  opts: {
    chunkSize?: number;
    overlap?: number;
    contextual?: boolean;
    embeddings?: { embed(texts: string[]): Promise<number[][]> } | null;
    context?: string | null;
  } = {},
): ChunkerLike {
  const chunkSize = opts.chunkSize ?? 512;
  const overlap = opts.overlap ?? 64;
  let inner: ChunkerLike;
  if (strategy === "none") inner = new IdentityChunker();
  else if (strategy === "recursive") inner = new RecursiveChunker(chunkSize, overlap);
  else if (strategy === "semantic")
    inner = new SemanticChunker(opts.embeddings ?? null, chunkSize, overlap);
  else inner = new FixedChunker(chunkSize, overlap);
  if (opts.contextual) return new ContextualChunker(inner, opts.context);
  return inner;
}
