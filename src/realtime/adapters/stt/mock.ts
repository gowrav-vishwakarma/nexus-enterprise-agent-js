/** Mock STT adapter for tests and local development. */

import { createSTTConfig, type STTConfig } from "../../config.js";
import { STTAdapter } from "./base.js";

export class MockSTT extends STTAdapter {
  readonly fixedTranscript?: string | null;

  constructor(config?: STTConfig | null, fixedTranscript?: string | null) {
    super(config ?? createSTTConfig({ provider: "mock" }));
    this.fixedTranscript = fixedTranscript ?? (this.config.extra.transcript as string | undefined) ?? null;
  }

  async transcribe(
    audio: Uint8Array | Buffer,
    _mimeType = "audio/wav",
    _options?: { language?: string | null },
  ): Promise<string> {
    if (this.fixedTranscript != null) return this.fixedTranscript;
    try {
      return Buffer.from(audio).toString("utf-8").trim();
    } catch {
      return `[${audio.length} bytes of audio]`;
    }
  }
}
