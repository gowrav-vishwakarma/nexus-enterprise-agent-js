/** Energy-based VAD: a dependency-free turn detector for PCM16 audio. */

import { createVADConfig, type VADConfig } from "../../config.js";
import { VADAdapter, VADEvent } from "./base.js";

export { VADEvent };

const INT16_MAX = 32768.0;

function frameRms(frame: Buffer): number {
  if (frame.length < 2) return 0;
  const count = Math.floor(frame.length / 2);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const sample = frame.readInt16LE(i * 2);
    total += sample * sample;
  }
  return Math.sqrt(total / count) / INT16_MAX;
}

export class EnergyVAD extends VADAdapter {
  private inSpeech = false;
  private buffer = Buffer.alloc(0);
  private silenceMs = 0;
  private speechMs = 0;
  private readonly sampleRate: number;

  constructor(config?: VADConfig | null) {
    super(config ?? createVADConfig({ provider: "energy" }));
    this.sampleRate = this.config.sample_rate;
  }

  private frameMs(frame: Buffer): number {
    const samples = frame.length / 2;
    return this.sampleRate ? (samples / this.sampleRate) * 1000 : 0;
  }

  processFrame(frame: Uint8Array | Buffer): VADEvent | null {
    const buf = Buffer.from(frame);
    const energy = frameRms(buf);
    const ms = this.frameMs(buf);
    const isSpeech = energy >= this.config.threshold;

    if (isSpeech) {
      this.silenceMs = 0;
      if (!this.inSpeech) {
        this.inSpeech = true;
        this.speechMs = 0;
        this.buffer = Buffer.from(buf);
        return VADEvent.SPEECH_START;
      }
      this.speechMs += ms;
      this.buffer = Buffer.concat([this.buffer, buf]);
      return null;
    }

    if (this.inSpeech) {
      this.buffer = Buffer.concat([this.buffer, buf]);
      this.silenceMs += ms;
      if (this.silenceMs >= this.config.silence_ms) {
        if (this.speechMs >= this.config.min_speech_ms) {
          this.inSpeech = false;
          return VADEvent.SPEECH_END;
        }
        this.inSpeech = false;
        this.buffer = Buffer.alloc(0);
      }
    }
    return null;
  }

  takeUtterance(): Buffer {
    const data = this.buffer;
    this.buffer = Buffer.alloc(0);
    return data;
  }

  reset(): void {
    this.inSpeech = false;
    this.buffer = Buffer.alloc(0);
    this.silenceMs = 0;
    this.speechMs = 0;
  }
}
