/** In-memory transport for tests and local simulation. */

import type { RealtimeStreamEvent } from "../events.js";
import { Transport } from "./base.js";

export class InMemoryTransport extends Transport {
  private inbound: Array<Buffer | null> = [];
  private waiters: Array<(value: Buffer | null) => void> = [];
  readonly sentAudio: Buffer[] = [];
  readonly sentEvents: RealtimeStreamEvent[] = [];

  async pushAudio(chunk: Uint8Array | Buffer): Promise<void> {
    const buf = Buffer.from(chunk);
    const waiter = this.waiters.shift();
    if (waiter) waiter(buf);
    else this.inbound.push(buf);
  }

  async endInput(): Promise<void> {
    const waiter = this.waiters.shift();
    if (waiter) waiter(null);
    else this.inbound.push(null);
  }

  async *receiveAudio(): AsyncIterable<Buffer> {
    while (true) {
      const chunk = await this.nextInbound();
      if (chunk == null) return;
      yield chunk;
    }
  }

  async sendAudio(chunk: Uint8Array | Buffer): Promise<void> {
    this.sentAudio.push(Buffer.from(chunk));
  }

  async sendEvent(event: RealtimeStreamEvent): Promise<void> {
    this.sentEvents.push(event);
  }

  private nextInbound(): Promise<Buffer | null> {
    const queued = this.inbound.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
