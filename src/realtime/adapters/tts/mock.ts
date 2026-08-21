/** Mock TTS adapter for tests and local development. */

import { createTTSConfig, type TTSConfig } from "../../config.js";
import { TTSAdapter } from "./base.js";

export class MockTTS extends TTSAdapter {
  constructor(config?: TTSConfig | null) {
    super(config ?? createTTSConfig({ provider: "mock" }));
  }

  async synthesize(
    text: string,
    options: { language?: string | null; voice?: string | null } = {},
  ): Promise<Buffer> {
    const prefix = `AUDIO:${options.language || "default"}:`;
    return Buffer.concat([Buffer.from(prefix, "utf-8"), Buffer.from(text, "utf-8")]);
  }
}
