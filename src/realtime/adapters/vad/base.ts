/** Base voice-activity-detection adapter interface. */

import type { VADConfig } from "../../config.js";

export enum VADEvent {
  SPEECH_START = "speech_start",
  SPEECH_END = "speech_end",
}

export abstract class VADAdapter {
  constructor(readonly config: VADConfig) {}

  abstract processFrame(frame: Uint8Array | Buffer): VADEvent | null;
  abstract takeUtterance(): Buffer;
  abstract reset(): void;
}
