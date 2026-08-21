/** Base speech-to-text adapter interface. */

import type { STTConfig } from "../../config.js";

export interface STTResult {
  text: string;
  is_final: boolean;
  confidence: number;
}

export abstract class STTAdapter {
  constructor(readonly config: STTConfig) {}

  abstract transcribe(
    audio: Uint8Array | Buffer,
    mimeType?: string,
    options?: { language?: string | null },
  ): Promise<string>;

  async *streamTranscribe(
    audioStream: AsyncIterable<Uint8Array | Buffer>,
    options: { language?: string | null } = {},
  ): AsyncGenerator<STTResult> {
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.from(chunk));
    }
    const text = await this.transcribe(Buffer.concat(chunks), "audio/wav", options);
    if (text) {
      yield { text, is_final: true, confidence: 1 };
    }
  }
}
