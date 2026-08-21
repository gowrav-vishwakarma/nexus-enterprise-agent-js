/** Telegram Bot API channel adapter (library-only; HTTP client is injectable). */

import { AudioPart, ImageBase64Part, TextPart, UserInput } from "../../realtime/input.js";
import type { AgentOutput, ChannelAdapter, InboundMessage } from "../base.js";

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface HttpClient {
  get(url: string, init?: { params?: Record<string, string> }): Promise<HttpResponse>;
  post(
    url: string,
    init?: { json?: unknown; data?: Record<string, string>; files?: Record<string, unknown> },
  ): Promise<HttpResponse>;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly kind = "messaging" as const;
  readonly name: string;
  readonly token: string;
  readonly apiBase: string;
  readonly downloadMedia: boolean;
  private client?: HttpClient | null;

  constructor(
    token: string,
    options: {
      name?: string;
      apiBase?: string;
      httpClient?: HttpClient | null;
      downloadMedia?: boolean;
    } = {},
  ) {
    this.token = token;
    this.name = options.name ?? "telegram";
    this.apiBase = (options.apiBase ?? "https://api.telegram.org").replace(/\/$/, "");
    this.client = options.httpClient ?? null;
    this.downloadMedia = options.downloadMedia ?? true;
  }

  private api(method: string): string {
    return `${this.apiBase}/bot${this.token}/${method}`;
  }

  private async getClient(): Promise<HttpClient> {
    if (!this.client) {
      throw new Error(
        "TelegramAdapter: pass an httpClient (library-only). The TypeScript port does not bundle an HTTP client.",
      );
    }
    return this.client;
  }

  async parseInbound(raw: unknown): Promise<InboundMessage> {
    const rec = (raw ?? {}) as Record<string, unknown>;
    const message = (rec.message ?? rec.edited_message ?? {}) as Record<string, unknown>;
    const chat = (message.chat ?? {}) as Record<string, unknown>;
    const sender = (message.from ?? {}) as Record<string, unknown>;
    const chatId = String(chat.id ?? sender.id ?? "");
    const userId = String(sender.id ?? chatId);
    const parts: Array<TextPart | AudioPart | ImageBase64Part> = [];
    const text = (message.text ?? message.caption) as string | undefined;
    if (text) parts.push(new TextPart(text));

    if (this.downloadMedia) {
      const voice = (message.voice ?? message.audio) as Record<string, unknown> | undefined;
      if (voice?.file_id) {
        const audio = await this.downloadFile(String(voice.file_id));
        if (audio) {
          parts.push(AudioPart.from_bytes(audio, String(voice.mime_type ?? "audio/ogg")));
        }
      }
      const photos = message.photo as Array<Record<string, unknown>> | undefined;
      if (photos?.length) {
        const largest = photos.reduce((a, b) =>
          Number(a.file_size ?? 0) >= Number(b.file_size ?? 0) ? a : b,
        );
        const image = await this.downloadFile(String(largest.file_id));
        if (image) parts.push(ImageBase64Part.from_bytes(image, "image/jpeg"));
      }
    }

    if (!parts.length) parts.push(new TextPart(""));
    return {
      channel: this.name,
      channelUserId: userId,
      channelChatId: chatId,
      userInput: new UserInput(parts),
      raw: rec,
      kind: this.kind,
    };
  }

  private async downloadFile(fileId: string): Promise<Buffer | null> {
    try {
      const client = await this.getClient();
      const resp = await client.get(this.api("getFile"), { params: { file_id: fileId } });
      const body = (await resp.json()) as { result?: { file_path?: string } };
      const filePath = body.result?.file_path;
      if (!filePath) return null;
      const data = await client.get(`${this.apiBase}/file/bot${this.token}/${filePath}`);
      return Buffer.from(await data.arrayBuffer());
    } catch (error) {
      console.warn(`TelegramAdapter: failed to download ${fileId}: ${String(error)}`);
      return null;
    }
  }

  async sendReply(message: InboundMessage, output: AgentOutput): Promise<void> {
    const chatId = message.channelChatId || message.channelUserId;
    const client = await this.getClient();
    if (output.text) {
      await client.post(this.api("sendMessage"), { json: { chat_id: chatId, text: output.text } });
    }
    if (output.audio) {
      await client.post(this.api("sendVoice"), {
        data: { chat_id: chatId },
        files: { voice: output.audio },
      });
    }
  }
}
