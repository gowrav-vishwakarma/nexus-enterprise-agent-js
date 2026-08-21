/** WebSocket transport (duck-typed: ws library or WebSocket-like objects). */

import { RealtimeStreamEvent } from "../events.js";
import { Transport } from "./base.js";

export interface WebSocketLike {
  send?(data: string | Uint8Array | Buffer): void | Promise<void>;
  sendBytes?(data: Uint8Array | Buffer): Promise<void>;
  sendText?(data: string): Promise<void>;
  receive?(): Promise<{ type?: string; bytes?: Buffer; text?: string }>;
  close?(): void | Promise<void>;
  [Symbol.asyncIterator]?: () => AsyncIterator<string | Uint8Array | Buffer>;
}

export class WebSocketTransport extends Transport {
  readonly ws: WebSocketLike;
  readonly sendAudioAsBase64: boolean;
  readonly onControl?: ((payload: Record<string, unknown>) => void) | null;
  private readonly isFastApi: boolean;

  constructor(
    ws: WebSocketLike,
    options: {
      sendAudioAsBase64?: boolean;
      onControl?: ((payload: Record<string, unknown>) => void) | null;
    } = {},
  ) {
    super();
    this.ws = ws;
    this.sendAudioAsBase64 = options.sendAudioAsBase64 ?? false;
    this.onControl = options.onControl ?? null;
    this.isFastApi = typeof ws.sendBytes === "function" && typeof ws.receive === "function";
  }

  async *receiveAudio(): AsyncIterable<Buffer> {
    if (this.isFastApi && this.ws.receive) {
      while (true) {
        let message: { type?: string; bytes?: Buffer; text?: string };
        try {
          message = await this.ws.receive();
        } catch {
          return;
        }
        if (message.type === "websocket.disconnect") return;
        if (message.bytes != null) yield Buffer.from(message.bytes);
        else if (message.text != null) this.handleControl(message.text);
      }
    }

    const iterator = this.ws[Symbol.asyncIterator]?.();
    if (!iterator) return;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      const message = next.value;
      if (typeof message === "string") this.handleControl(message);
      else yield Buffer.from(message);
    }
  }

  private handleControl(text: string): void {
    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      this.onControl?.(payload);
    } catch {
      // ignore non-JSON control frames
    }
  }

  async sendAudio(chunk: Uint8Array | Buffer): Promise<void> {
    if (this.sendAudioAsBase64) {
      await this.sendText(
        JSON.stringify({
          type: "audio_out",
          audio_b64: Buffer.from(chunk).toString("base64"),
        }),
      );
      return;
    }
    if (this.isFastApi && this.ws.sendBytes) {
      await this.ws.sendBytes(chunk);
      return;
    }
    await this.ws.send?.(chunk);
  }

  async sendEvent(event: RealtimeStreamEvent): Promise<void> {
    const payload = event.toJSON();
    if (event.audio != null && this.sendAudioAsBase64) {
      payload.audio_b64 = event.audio_b64;
    }
    await this.sendText(JSON.stringify(payload));
  }

  private async sendText(text: string): Promise<void> {
    if (this.isFastApi && this.ws.sendText) {
      await this.ws.sendText(text);
      return;
    }
    await this.ws.send?.(text);
  }

  async close(): Promise<void> {
    try {
      await this.ws.close?.();
    } catch {
      // ignore
    }
  }
}
