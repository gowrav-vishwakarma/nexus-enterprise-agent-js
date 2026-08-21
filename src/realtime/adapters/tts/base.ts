/** Base text-to-speech adapter interface. */

import type { TTSConfig } from "../../config.js";

export abstract class TTSAdapter {
  constructor(readonly config: TTSConfig) {}

  abstract synthesize(
    text: string,
    options?: { language?: string | null; voice?: string | null; [key: string]: unknown },
  ): Promise<Buffer>;

  async *streamSynthesize(
    textStream: AsyncIterable<string>,
    options: { language?: string | null; voice?: string | null } = {},
  ): AsyncGenerator<Buffer> {
    let buffer = "";
    const boundaries = [".", "!", "?", "\n"];
    for await (const delta of textStream) {
      if (!delta) continue;
      buffer += delta;
      while (boundaries.some((b) => buffer.includes(b))) {
        const found = boundaries.map((b) => buffer.indexOf(b)).filter((i) => i >= 0);
        if (!found.length) break;
        const idx = Math.min(...found);
        const sentence = buffer.slice(0, idx + 1).trim();
        buffer = buffer.slice(idx + 1);
        if (sentence) {
          yield await this.synthesize(sentence, options);
        }
      }
    }
    const tail = buffer.trim();
    if (tail) {
      yield await this.synthesize(tail, options);
    }
  }
}
