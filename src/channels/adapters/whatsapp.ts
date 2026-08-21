/** WhatsApp Cloud API channel adapter (library-only; HTTP client is injectable). */

import { AudioPart, ImageBase64Part, TextPart, UserInput } from "../../realtime/input.js";
import type { AgentOutput, ChannelAdapter, InboundMessage } from "../base.js";
import type { HttpClient } from "./telegram.js";

export class WhatsAppAdapter implements ChannelAdapter {
  readonly kind = "messaging" as const;
  readonly name: string;
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly apiBase: string;
  readonly apiVersion: string;
  readonly downloadMedia: boolean;
  private client?: HttpClient | null;

  constructor(
    accessToken: string,
    phoneNumberId: string,
    options: {
      name?: string;
      apiBase?: string;
      apiVersion?: string;
      httpClient?: HttpClient | null;
      downloadMedia?: boolean;
    } = {},
  ) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.name = options.name ?? "whatsapp";
    this.apiBase = (options.apiBase ?? "https://graph.facebook.com").replace(/\/$/, "");
    this.apiVersion = options.apiVersion ?? "v21.0";
    this.client = options.httpClient ?? null;
    this.downloadMedia = options.downloadMedia ?? true;
  }

  private async getClient(): Promise<HttpClient> {
    if (!this.client) {
      throw new Error(
        "WhatsAppAdapter: pass an httpClient (library-only). The TypeScript port does not bundle an HTTP client.",
      );
    }
    return this.client;
  }

  private static firstMessage(raw: unknown): Record<string, unknown> {
    try {
      const rec = raw as {
        entry: Array<{ changes: Array<{ value: { messages?: Array<Record<string, unknown>> } }> }>;
      };
      const messages = rec.entry[0]?.changes[0]?.value.messages ?? [];
      return messages[0] ?? {};
    } catch {
      return {};
    }
  }

  async parseInbound(raw: unknown): Promise<InboundMessage> {
    const msg = WhatsAppAdapter.firstMessage(raw);
    const sender = String(msg.from ?? "");
    const msgType = msg.type;
    const parts: Array<TextPart | AudioPart | ImageBase64Part> = [];

    if (msgType === "text") {
      const body = String((msg.text as { body?: string } | undefined)?.body ?? "");
      parts.push(new TextPart(body));
    } else if (msgType === "audio" && this.downloadMedia) {
      const media = (msg.audio ?? {}) as Record<string, unknown>;
      const data = await this.downloadMediaBytes(media.id != null ? String(media.id) : null);
      if (data) parts.push(AudioPart.from_bytes(data, String(media.mime_type ?? "audio/ogg")));
    } else if (msgType === "image" && this.downloadMedia) {
      const media = (msg.image ?? {}) as Record<string, unknown>;
      const data = await this.downloadMediaBytes(media.id != null ? String(media.id) : null);
      if (data) {
        parts.push(ImageBase64Part.from_bytes(data, String(media.mime_type ?? "image/jpeg")));
      }
      if (media.caption) parts.unshift(new TextPart(String(media.caption)));
    }

    if (!parts.length) parts.push(new TextPart(""));
    return {
      channel: this.name,
      channelUserId: sender,
      channelChatId: sender,
      userInput: new UserInput(parts),
      raw: (raw ?? {}) as Record<string, unknown>,
      kind: this.kind,
    };
  }

  private async downloadMediaBytes(mediaId?: string | null): Promise<Buffer | null> {
    if (!mediaId) return null;
    try {
      const client = await this.getClient();
      const meta = await client.get(`${this.apiBase}/${this.apiVersion}/${mediaId}`);
      const url = String((await meta.json() as { url?: string }).url ?? "");
      const data = await client.get(url);
      return Buffer.from(await data.arrayBuffer());
    } catch (error) {
      console.warn(`WhatsAppAdapter: failed to download media ${mediaId}: ${String(error)}`);
      return null;
    }
  }

  async sendReply(message: InboundMessage, output: AgentOutput): Promise<void> {
    if (!output.text) return;
    const client = await this.getClient();
    await client.post(`${this.apiBase}/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      json: {
        messaging_product: "whatsapp",
        to: message.channelUserId,
        type: "text",
        text: { body: output.text },
      },
    });
  }
}
