/** Build media adapters from config (client-side mock / energy only). */

import type { STTConfig, TTSConfig, VADConfig } from "../config.js";
import type { STTAdapter } from "./stt/base.js";
import { MockSTT } from "./stt/mock.js";
import type { TTSAdapter } from "./tts/base.js";
import { MockTTS } from "./tts/mock.js";
import type { VADAdapter } from "./vad/base.js";
import { EnergyVAD } from "./vad/energy.js";

const GPU_HINT =
  "GPU / gRPC media servers stay in the Python package. Use provider 'mock' or 'energy' in the TypeScript client.";

export function buildStt(config: STTConfig): STTAdapter {
  const provider = config.provider.toLowerCase();
  if (provider === "mock" || provider === "test") {
    return new MockSTT(config);
  }
  throw new Error(`Unknown STT provider: '${config.provider}'. ${GPU_HINT}`);
}

export function buildTts(config: TTSConfig): TTSAdapter {
  const provider = config.provider.toLowerCase();
  if (provider === "mock" || provider === "test") {
    return new MockTTS(config);
  }
  throw new Error(`Unknown TTS provider: '${config.provider}'. ${GPU_HINT}`);
}

export function buildVad(config: VADConfig): VADAdapter {
  const provider = config.provider.toLowerCase();
  if (provider === "energy" || provider === "mock" || provider === "test") {
    return new EnergyVAD(config);
  }
  throw new Error(`Unknown VAD provider: '${config.provider}'. ${GPU_HINT}`);
}
