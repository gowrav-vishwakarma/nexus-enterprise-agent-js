/** Base transport interface for realtime sessions. */

import type { RealtimeStreamEvent } from "../events.js";

export abstract class Transport {
  abstract receiveAudio(): AsyncIterable<Buffer>;
  abstract sendAudio(chunk: Uint8Array | Buffer): Promise<void>;
  abstract sendEvent(event: RealtimeStreamEvent): Promise<void>;

  async close(): Promise<void> {
    return undefined;
  }
}

export { Transport as BaseTransport };
